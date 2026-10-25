// One example picture per Studio style (Param 25 Oct: the tiles showed the brand's own packshot again and again, "copy paste").
// Made once, on a neutral unbranded product, so a tile shows what the style looks like for every brand; the composer tags it
// Example. Paid (Vertex Gemini image, about $0.04 each): run only on purpose. `node tools/style-examples.mjs [--only id,id] [--force]`
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LIBF = path.join(ROOT, 'data/studio-styles.json'), MAPF = path.join(ROOT, 'data/style-examples.json'), OUT = path.join(ROOT, 'public/style-examples');
const P = process.env.GOOGLE_CLOUD_PROJECT || 'squareup-492617', MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const args = process.argv.slice(2), only = (args[args.indexOf('--only') + 1] || '').split(',').filter((x) => args.includes('--only') && x), force = args.includes('--force');
const PRODUCT = 'a plain unbranded skincare bottle: matte warm-white with a soft sage cap and a blank label';
const NO_WORDS = 'No words, letters, numbers, logos or watermarks anywhere in the picture.';
const prompt = (st, kind) => {
  const lib = st.look.replace(/the brand's colours?/gi, 'a warm coral').replace(/the real product/gi, 'the product');
  const words = /offer-card/.test(st.id) ? 'The poster carries only a big "20% OFF" and nothing else written.' : /quote-card/.test(st.id) ? 'The card shows five stars and a few short lines of placeholder text, softly blurred so no words are readable.' : /mp-benefits|aplus-hero/.test(st.id) ? 'Callouts are short grey bars and small icons, never readable words.' : NO_WORDS;
  return `${kind === 'video' ? 'One still frame from a vertical phone video. ' : ''}A photo that shows this style of product picture, for a style catalogue. The product is ${PRODUCT}. ${lib} ${words} Real photography, natural and believable, sharp, well composed.`;
};
const token = execFileSync('gcloud', ['auth', 'print-access-token']).toString().trim();
async function make(st, kind) {
  const ratio = kind === 'video' ? '9:16' : '4:5';
  const r = await fetch(`https://aiplatform.googleapis.com/v1/projects/${P}/locations/global/publishers/google/models/${MODEL}:generateContent`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-goog-user-project': P, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt(st, kind) }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio } } }) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const img = (await r.json()).candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData; if (!img) throw new Error('no image');
  const raw = path.join(OUT, `${st.id}.raw`); fs.writeFileSync(raw, Buffer.from(img.data, 'base64'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-vf', 'scale=480:-2', '-q:v', '4', path.join(OUT, `${st.id}.jpg`)]); fs.rmSync(raw);
}
fs.mkdirSync(OUT, { recursive: true });
const lib = JSON.parse(fs.readFileSync(LIBF, 'utf8')), map = fs.existsSync(MAPF) ? JSON.parse(fs.readFileSync(MAPF, 'utf8')) : {}; let n = 0;
for (const kind of ['image', 'video']) for (const g of lib[kind]) { if (g.source) continue;
  for (const st of g.styles) { if (st.id === 'recreate-swap' || (only.length && !only.includes(st.id))) continue; /* recreate shows the brand's own video */
    const file = path.join(OUT, `${st.id}.jpg`);
    if (!fs.existsSync(file) || force) { try { await make(st, kind); n++; console.log('made', st.id); } catch (e) { console.warn('failed', st.id, e.message); continue; } }
    map[st.id] = `style-examples/${st.id}.jpg`; } }
fs.writeFileSync(MAPF, JSON.stringify(map, null, 1) + '\n'); /* jam2/studio.js library() puts each on its style as `example` */ console.log(`${n} made, about $${(n * 0.04).toFixed(2)}`);
