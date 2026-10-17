// Every generated picture shows the right product. One wrapper around the image model, so every caller (jam drafts,
// background drafts, carousel slides, feed idea images, remix, research) gets the same three guarantees:
//   1. the reference photo is the product the words name (matched against the brand's catalog), not a card's or a
//      lane's default shot; when nothing is named, the caller's own photo stays;
//   2. the prompt tells the model to keep that product exactly as photographed;
//   3. after generating, a vision check compares the result with the reference. A mismatch is regenerated once with a
//      stricter prompt; if it still doesn't match, the real product photo is used instead. A wrong product never ships.
// Without a catalog or a reference photo there's nothing to check against and it behaves exactly like the model.
// Two more, so a picture never fails for a reason we could have handled:
//   4. a reference path that isn't on this instance's disk (a brand asset or research photo only in the bucket, a store
//      URL) is resolved first (resolve), and with none at all the brand's lead catalog photo stands in;
//   5. the model is tried up to `tries` times with backoff (a 429, a 5xx or "no image came back" is usually gone a few
//      seconds later). If it still fails and the caller asked for it (fallback: true), the real product photo comes back
//      instead, marked guard.genFailed, so the caller can show a real picture now and retry the new one later.
import fs from 'node:fs';
import { matchProduct, junkPhoto } from './product-match.js';
import path from 'node:path';

const KEEP = (name) => `The product${name ? `, ${name},` : ''} must appear exactly as in the reference photo: the same model, shape, colours, prints, materials and logo. Do not redesign it, swap it for another product, or add a second product.`;
const STRICT = 'Important: the last attempt showed a different product. Copy the product from the reference photo faithfully; only the scene, light and framing may change.';

// gen({srcFile, prompt, ratio, model}) → Buffer; verify(refFile, buf, name) → { same: boolean, why? }; fetchPhoto(urlOrRel) → local file | null
// context() → the active brand pack or null (never a default brand: a wrong catalog would swap in another brand's product)
const isFile = (f) => { try { return !!f && fs.statSync(f).isFile(); } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// resolve(path) → a local file for a reference this instance lacks (the server maps brand assets, research and gen files to the bucket)
/* normalize(file) → a file the models accept (img-norm.js: an SVG, GIF or AVIF product photo becomes a PNG); identity by default */
export function createImageGuard({ gen, verify = null, fetchPhoto = async () => null, resolve = async () => null, normalize = async (f) => f, context = () => null, tries = 3, backoffMs = 2000, log = console }) {
  /* the model, tried again on a failure: 2 s, then 6 s (a refused or blocked prompt is not retried) */
  const genRetry = async (o) => { let last;
    for (let i = 0; i < tries; i++) {
      try { return await gen(o); }
      catch (e) { last = e; if (/\b(400|403)\b|blocked|safety|refus/i.test(e.message) && !/no image/i.test(e.message)) break; if (i < tries - 1) { log.warn?.('[image-guard] model failed, trying again', e.message.slice(0, 160)); await sleep(backoffMs * (i ? 3 : 1)); } }
    }
    throw last; };
  return async function guardedImage(o = {}) {
    const b = context(), catalog = o.catalog ?? b?.catalog ?? null, brand = o.brand ?? b?.seed?.brand?.name ?? b?.name ?? '';
    /* o.named: the product the caller already knows the picture is about (the card's asset line names it), else the words' */
    const named = o.product === false ? null : o.named?.img ? o.named : matchProduct(`${o.text || ''}\n${o.prompt || ''}`, catalog, { brand });
    /* a logo or brand mark is never the product: with only that, the brand's lead product stands in, else there is no picture */
    let ref = o.srcFile && !junkPhoto(path.basename(String(o.srcFile))) && !/\/a\/(logo|mark)\.[a-z]+$/i.test(String(o.srcFile)) ? o.srcFile : null;
    if (ref && !isFile(ref)) ref = (await resolve(ref).catch(() => null)) || null; /* a path this instance lacks: the bucket's copy, or nothing */
    if (named) { const f = await fetchPhoto(named.img).catch(() => null); if (f) ref = f; }
    if (o.srcFile && !ref && catalog?.[0]?.img) ref = (await fetchPhoto(catalog[0].img).catch(() => null)) || null; /* the caller wanted a reference: the brand's lead product, never an invented one */
    if (o.srcFile && !ref) throw Object.assign(new Error('There is no product photo for this yet. Add one with + (Product photo) and try again.'), { soft: true, noPhoto: true });
    /* every picture the model and the check see is a PNG, JPEG or WebP: a store's SVG or AVIF photo is turned into one first */
    if (ref) ref = await normalize(ref);
    const refFiles = o.refFiles?.length ? (await Promise.all(o.refFiles.map((f) => normalize(f).catch((e) => { log.warn?.('[image-guard] reference dropped', e.message); return null; })))).filter(Boolean) : [];
    const base = { ...o, srcFile: ref, refFiles, prompt: ref ? `${o.prompt}\n\n${KEEP(named?.t)}` : o.prompt };
    delete base.text; delete base.catalog; delete base.brand; delete base.product; delete base.fallback; delete base.named;
    const note = { product: named?.t || null, ref: !!ref, checked: false, same: null, retried: false, fallback: false, genFailed: false };
    let buf;
    try { buf = await genRetry(base); }
    catch (e) {
      if (!o.fallback || !ref) throw e;
      log.warn?.('[image-guard] no picture came back; using the real photo for now', named?.t || '', e.message.slice(0, 160));
      return Object.assign(fs.readFileSync(ref), { guard: { ...note, fallback: true, genFailed: true, error: String(e.message).slice(0, 200) } });
    }
    if (ref && verify) {
      try {
        let v = await verify(ref, buf, named?.t); note.checked = true; note.same = !!v?.same;
        if (!v?.same) {
          log.warn?.('[image-guard] product mismatch, retrying', named?.t || '', v?.why || '');
          note.retried = true; buf = await genRetry({ ...base, prompt: `${base.prompt}\n${STRICT}` }).catch((e) => { if (!o.fallback) throw e; return null; }); if (!buf) { buf = fs.readFileSync(ref); note.fallback = true; note.genFailed = true; return Object.assign(buf, { guard: note }); }
          v = await verify(ref, buf, named?.t); note.same = !!v?.same;
          if (!v?.same) { log.warn?.('[image-guard] still a different product; using the real photo', named?.t || ''); buf = fs.readFileSync(ref); note.fallback = true; note.genFailed = true; } /* a stand-in, not the new picture: callers retry it later */
        }
      } catch (e) {
        // the check itself failed: try it once more; a named product that can't be confirmed falls back to its real photo
        try { const v = await verify(ref, buf, named?.t); note.checked = true; note.same = !!v?.same; if (!v?.same && named) { buf = fs.readFileSync(ref); note.fallback = true; note.genFailed = true; } }
        catch (e2) { log.warn?.('[image-guard] check unavailable', e2.message); if (named) { buf = fs.readFileSync(ref); note.fallback = true; note.genFailed = true; } }
      }
    }
    return Object.assign(buf, { guard: note });
  };
}
