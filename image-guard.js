// Every generated picture shows the right product. One wrapper around the image model, so every caller (jam drafts,
// background drafts, carousel slides, feed idea images, remix, research) gets the same three guarantees:
//   1. the reference photo is the product the words name (matched against the brand's catalog), not a card's or a
//      lane's default shot; when nothing is named, the caller's own photo stays;
//   2. the prompt tells the model to keep that product exactly as photographed;
//   3. after generating, a vision check compares the result with the reference and answers one of four (server.js sameProduct):
//      SAME (the product's type, shape, colours, pack design and count; soft or garbled small print still counts) keeps it;
//      TEXT (the right product, its name misspelled in large letters) is made once more on the other Gemini model with the
//      product turned and smaller, and if the name is still off the new picture is kept, marked guard.labelApprox (never the
//      packshot); NOREF (the reference is a logo, a graphic or a screenshot) moves to the next catalog photo, else keeps the
//      picture unchecked (guard.unchecked); DIFFERENT is made again stricter, and if it still doesn't match the real product
//      photo is used instead. A wrong product never ships.
// Without a catalog or a reference photo there's nothing to check against and it behaves exactly like the model.
// Two more, so a picture never fails for a reason we could have handled:
//   4. a reference path that isn't on this instance's disk (a brand asset or research photo only in the bucket, a store
//      URL) is resolved first (resolve), and with none at all the brand's lead catalog photo stands in;
//   6. the picture is judged as an ad before anyone sees it (draft-quality.js): a collage or paste-up, a product cut off by the
//      frame, or a picture that isn't about the card's words is made once more with the reason; a second failure is held back
//      (fallback callers get the real product photo, marked genFailed + held, and remake it later; others get a plain error).
//      The reference is the product's cleanest photo (plainest): a designed store card copied by the model reads as a collage.
//   5. the model is tried up to `tries` times with backoff (a 429, a 5xx or "no image came back" is usually gone a few
//      seconds later). If it still fails and the caller asked for it (fallback: true), the real product photo comes back
//      instead, marked guard.genFailed, so the caller can show a real picture now and retry the new one later.
import fs from 'node:fs';
import { matchProduct, junkPhoto } from './product-match.js';
import path from 'node:path';
import { collageEdges, plainest, FIX } from './draft-quality.js';

const KEEP = (name) => `The product${name ? `, ${name},` : ''} must be the same product as in the reference photo: the same product type, shape, colours, materials, pack design and brand mark, and the same number of items. Do not redesign it, swap it for another product, or add a second product; its small print may be soft or turned away, never rewritten.`;
const STRICT = 'Important: the last attempt showed a different product. Copy the product from the reference photo faithfully; only the scene, light and framing may change.';
const TURN = 'Show the product turned slightly, at most a third of the frame; its small print may be soft, never rewritten.';
/* a check's answer as one word: old checkers return only { same } */
export const verdictOf = (v) => (v?.noref ? 'noref' : v?.text ? 'text' : v?.same ? 'same' : 'different');

// gen({srcFile, prompt, ratio, model}) → Buffer; verify(refFile, buf, name) → { same, text?, noref?, why? }; fetchPhoto(urlOrRel) → local file | null
// textModel: the other Gemini image model, for a picture whose product name came out misspelled (TEXT)
// context() → the active brand pack or null (never a default brand: a wrong catalog would swap in another brand's product)
const isFile = (f) => { try { return !!f && fs.statSync(f).isFile(); } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// resolve(path) → a local file for a reference this instance lacks (the server maps brand assets, research and gen files to the bucket)
/* normalize(file) → a file the models accept (img-norm.js: an SVG, GIF or AVIF product photo becomes a PNG); identity by default */
export function createImageGuard({ balance = null, gen, verify = null, fetchPhoto = async () => null, resolve = async () => null, normalize = async (f) => f, context = () => null, looks = null, pixels = collageEdges, pickRef = plainest, tries = 3, backoffMs = 2000, textModel = process.env.GEMINI_IMAGE_FALLBACK || 'gemini-3-pro-image', log = console }) {
  /* the model, tried again on a failure: 2 s, then 6 s (a refused or blocked prompt is not retried) */
  const genRetry = async (o) => { let last;
    for (let i = 0; i < tries; i++) {
      try { return await gen(o); }
      catch (e) { last = e; if (/\b(400|403)\b|blocked|safety|refus/i.test(e.message) && !/no image/i.test(e.message)) break; if (i < tries - 1) { log.warn?.('[image-guard] model failed, trying again', e.message.slice(0, 160)); await sleep(backoffMs * (i ? 3 : 1)); } }
    }
    throw last; };
  /* balance(buf, refFile) → { buf, fixed }: a picture washed warm is pulled back toward its product photo (color-cast.js) */
  const REF = Symbol('ref');
  const finish = async (r) => { if (!balance || !Buffer.isBuffer(r) || r.guard?.fallback) return r; const x = await balance(r, r[REF] || null).catch(() => null);
    return x?.fixed ? Object.assign(x.buf, { guard: { ...r.guard, warmFixed: true } }) : r; };
  return async (o = {}) => finish(await gated(o));
  /* looks(buf, words) → { ok, verdict, why } | null (server.js draftLooks); pixels(buf) → { collage, why } (free, first).
     Judged: every picture meant to show a product (not a background-only scene, an edit of a finished picture, a cut-out) */
  async function judge(buf, o) {
    /* a picture with words set in it on purpose (a headline box, a band) is not run through the flat-panel pixel test: its box is the design */
    if (!o.words) { const px = await pixels(buf).catch(() => null); if (px?.collage) return { ok: false, verdict: 'collage', why: px.why }; }
    if (!looks) return null; try { return await looks(buf, o.text || '', o.words || null); } catch (e) { log.warn?.('[image-guard] looks check unavailable', e.message); return null; } }
  async function gated(o) {
    const r = await guardedImage(o);
    if (o.product === false || o.edit || o.gate === false || !Buffer.isBuffer(r) || r.guard?.fallback) return r;
    const q = await judge(r, o); if (!q || q.ok) { if (q) r.guard.looks = q.verdict; return r; }
    log.warn?.('[image-guard] picture failed the look check, making it again', q.verdict, q.why);
    let r2 = null; try { r2 = await guardedImage({ ...o, prompt: `${o.prompt}\n${FIX[q.verdict] || FIX.collage}${o.words && q.verdict !== 'words' ? ` Keep the headline "${[].concat(o.words).join(' / ')}" set in the picture exactly as asked.` : ''}` }); } catch (e) { log.warn?.('[image-guard] look retry failed', e.message.slice(0, 160)); }
    const gens = (r.guard?.gens || 1) + (r2?.guard?.gens || 0), pro = (r.guard?.pro || 0) + (r2?.guard?.pro || 0);
    let q2 = null; if (r2 && !r2.guard?.fallback) { q2 = await judge(r2, o); if (!q2 || q2.ok) { r2.guard = { ...r2.guard, gens, pro, retried: true, looks: q2?.verdict || null, looksFixed: q.verdict }; return r2; } q.why = q2.why || q.why; }
    /* still not right twice: the second Sloosh picture is kept (never a raw store photo; 27 Oct), marked with what the judge saw, so the
       caller can lay the headline on itself (wordsMissing) or offer a redo. Only a fake expert (a lab coat) is never shown */
    const keep = r2 && !r2.guard?.fallback ? r2 : r;
    if (q.verdict !== 'expert' && (q2?.verdict || q.verdict) !== 'expert') { keep.guard = { ...keep.guard, gens, pro, retried: !!r2, looks: q2?.verdict || q.verdict, looksDoubt: String(q.why).slice(0, 160), ...((q2?.verdict || q.verdict) === 'words' ? { wordsMissing: true } : {}) }; return keep; }
    /* held back: never shown. The real product photo stands in for callers that take one; the rest get a plain error */
    const ref = r[REF] || r2?.[REF];
    if (o.fallback && ref) return Object.assign(fs.readFileSync(ref), { guard: { ...r.guard, gens, pro, fallback: true, genFailed: true, held: q.verdict, error: `held back: ${String(q.why).slice(0, 160)}` }, [REF]: ref });
    throw Object.assign(new Error(`The picture didn't come out clean enough to show (${String(q.why).slice(0, 140)}). Try again.`), { soft: true, held: q.verdict });
  }
  async function guardedImage(o = {}) {
    const b = context(), catalog = o.catalog ?? b?.catalog ?? null, brand = o.brand ?? b?.seed?.brand?.name ?? b?.name ?? '';
    /* o.named: the product the caller already knows the picture is about (the card's asset line names it), else the words' */
    const named = o.product === false ? null : o.named?.img ? o.named : matchProduct(`${o.text || ''}\n${o.prompt || ''}`, catalog, { brand });
    /* a logo or brand mark is never the product: with only that, the brand's lead product stands in, else there is no picture */
    let ref = o.srcFile && !junkPhoto(path.basename(String(o.srcFile))) && !/\/a\/(logo|mark)\.[a-z]+$/i.test(String(o.srcFile)) ? o.srcFile : null, refImg = null; /* refImg: the catalog photo the reference came from, if any */
    if (ref && !isFile(ref)) ref = (await resolve(ref).catch(() => null)) || null; /* a path this instance lacks: the bucket's copy, or nothing */
    if (named) { /* the product's cleanest photo: a packshot on a plain ground, never a designed card its store also shows */
      const views = [...new Set([named.img, ...(Array.isArray(named.imgs) ? named.imgs : [])].filter((x) => x && !junkPhoto(x)))].slice(0, 5);
      const files = (await Promise.all(views.map(async (u) => ({ key: u, file: await fetchPhoto(u).catch(() => null) })))).filter((x) => x.file);
      const pick = files.length > 1 ? await pickRef(files.map((x) => ({ key: x.key, file: x.file }))).catch(() => null) : files[0]?.key;
      const hit = files.find((x) => x.key === pick) || files[0]; if (hit) { ref = hit.file; refImg = hit.key; } }
    if (o.srcFile && !ref && catalog?.[0]?.img) { ref = (await fetchPhoto(catalog[0].img).catch(() => null)) || null; if (ref) refImg = catalog[0].img; } /* the caller wanted a reference: the brand's lead product, never an invented one */
    if (o.srcFile && !ref) throw Object.assign(new Error('There is no product photo for this yet. Add one with + (Product photo) and try again.'), { soft: true, noPhoto: true });
    /* every picture the model and the check see is a PNG, JPEG or WebP: a store's SVG or AVIF photo is turned into one first */
    if (ref) ref = await normalize(ref);
    const refFiles = o.refFiles?.length ? (await Promise.all(o.refFiles.map((f) => normalize(f).catch((e) => { log.warn?.('[image-guard] reference dropped', e.message); return null; })))).filter(Boolean) : [];
    let base = { ...o, srcFile: ref, refFiles, prompt: ref ? `${o.prompt}\n\n${KEEP(named?.t)}` : o.prompt, ...(named?.t && !o.productName ? { productName: named.t } : {}) };
    delete base.text; delete base.catalog; delete base.brand; delete base.product; delete base.fallback; delete base.named;
    /* gens: pictures made for this one (booked at real cost by callers); pro: how many of them on the other, dearer model */
    const note = { product: named?.t || null, ref: !!ref, checked: false, same: null, retried: false, fallback: false, genFailed: false, gens: 1, pro: 0 };
    let buf;
    try { buf = await genRetry(base); }
    catch (e) {
      if (!o.fallback || !ref) throw e;
      log.warn?.('[image-guard] no picture came back; using the real photo for now', named?.t || '', e.message.slice(0, 160));
      return Object.assign(fs.readFileSync(ref), { guard: { ...note, gens: 0, fallback: true, genFailed: true, error: String(e.message).slice(0, 200) } });
    }
    if (!ref || !verify) return Object.assign(buf, { guard: note, [REF]: ref });
    const done = () => Object.assign(buf, { guard: note, [REF]: ref });
    const standIn = () => { buf = fs.readFileSync(ref); note.fallback = true; note.genFailed = true; note.same = false; return done(); }; /* a stand-in, not the new picture: callers retry it later */
    /* the check, tried twice; null when it can't answer */
    let refName = named?.t;
    const check1 = async () => { const v = await verify(ref, buf, refName); note.checked = true; if (v?.why) note.why = String(v.why).slice(0, 160); return verdictOf(v); };
    const check = async () => { try { return await check1(); } catch (e) { try { return await check1(); } catch (e2) { log.warn?.('[image-guard] check unavailable', e2.message); return null; } } };
    /* one more picture: { buf } or { err } */
    const again = async (more) => { try { const b = await genRetry({ ...base, ...more }); note.gens++; note.retried = true; return { buf: b }; } catch (e) { log.warn?.('[image-guard] picture again failed', e.message.slice(0, 160)); return { err: e }; } };
    /* NOREF: the next product photo in the catalog (never a logo, a mark or a screenshot), up to three tried */
    const nextRef = async () => { const list = (catalog || []).filter((x) => x?.img && !junkPhoto(x.img) && !/\/a\/(logo|mark)\.[a-z]+$/i.test(x.img)), at = list.findIndex((x) => x.img === refImg); let n = 0;
      for (const x of [...list.slice(at + 1), ...list.slice(0, Math.max(0, at))]) { if (n++ >= 3) break; const f = await fetchPhoto(x.img).catch(() => null); if (f && f !== ref) { refImg = x.img; refName = x.t || refName; return normalize(f).catch(() => f); } }
      return null; };
    let w = await check(); note.verdict = w;
    if (w === null) { note.unchecked = true; return done(); } /* a check that can't answer keeps the Sloosh picture (made on the product photo with a keep line), marked unchecked: a raw store photo never stands in for it (27 Oct) */
    if (w === 'noref') { /* the reference was not a product photo: the next catalog photo, else the picture as made, unchecked */
      const next = await nextRef(); if (!next) { log.warn?.('[image-guard] the reference is not a product photo; keeping the picture unchecked', named?.t || ''); note.unchecked = true; note.same = null; return done(); }
      log.warn?.('[image-guard] the reference is not a product photo; trying the next catalog photo', refImg);
      ref = next; base = { ...base, srcFile: next }; note.refSwitched = true; note.product = refName || note.product;
      const r = await again({}); if (!r.buf) { note.unchecked = true; note.same = null; return done(); }
      buf = r.buf; w = await check(); note.verdict = w;
      if (w === null || w === 'noref') { note.unchecked = true; note.same = null; return done(); }
    }
    if (w === 'text') { /* the right product, its name misspelled large: once more on the other model, turned and smaller; if still off, keep it (never the packshot) */
      log.warn?.('[image-guard] product name misspelled, trying once more', named?.t || '', note.why || '');
      const first = buf, r = await again({ model: textModel, prompt: `${base.prompt}\n${TURN}` });
      if (r.buf) { note.pro++; buf = r.buf; const w2 = await check(); note.verdict = w2; if (w2 === 'same') { note.same = true; return done(); } if (w2 !== 'text') buf = first; } /* different, or no answer: the first picture was the right product */
      note.labelApprox = true; note.same = true; return done();
    }
    if (w === 'different') {
      log.warn?.('[image-guard] product mismatch, retrying', named?.t || '', note.why || '');
      const r = await again({ prompt: `${base.prompt}\n${STRICT}` });
      if (!r.buf) { if (!o.fallback) throw r.err; return standIn(); }
      buf = r.buf; const w2 = await check(); note.verdict = w2;
      if (w2 === 'same') { note.same = true; return done(); }
      if (w2 === 'text') { note.labelApprox = true; note.same = true; return done(); }
      if (w2 === 'noref' || (w2 === null && !named)) { note.unchecked = true; note.same = null; return done(); }
      log.warn?.('[image-guard] still a different product; using the real photo', named?.t || ''); return standIn();
    }
    note.same = true; return done();
  }
}
