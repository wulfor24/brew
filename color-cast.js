/* Yellow tint (QA 13 Oct: "the yellow-tint ad look"). Image models often wash a whole picture warm. After a picture is
   made, its average colour is compared with the product photo it was made from: when it came out much warmer (more red and
   green than blue) than that photo, its channels are pulled back toward the photo's balance. A product that is warm in its
   own photo (turmeric, gold, wood) keeps that, because the comparison is with its own photo. With no photo to compare
   against, only a strong cast is softened. Uses ffmpeg (in the Docker image); any failure keeps the picture as made. */
import { execFile } from 'node:child_process';
import fs from 'node:fs';

const FF = process.env.FFMPEG || 'ffmpeg';
const run = (args, input, max = 64 << 20) => new Promise((res, rej) => { const p = execFile(FF, args, { encoding: 'buffer', maxBuffer: max, timeout: 20000 }, (e, out) => (e ? rej(e) : res(out))); p.stdin.on('error', () => {}); p.stdin.end(input); });

/* mean R, G, B (0–255) of a picture, from a 48×48 thumbnail */
export async function meanRGB(buf) {
  const raw = await run(['-v', 'error', '-i', 'pipe:0', '-vf', 'scale=48:48', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], buf);
  if (!raw?.length || raw.length < 3) throw new Error('no pixels');
  let r = 0, g = 0, b = 0; const n = Math.floor(raw.length / 3);
  for (let i = 0; i < n * 3; i += 3) { r += raw[i]; g += raw[i + 1]; b += raw[i + 2]; }
  return { r: r / n, g: g / n, b: b / n };
}
/* warmth: how far red+green sit above blue, relative to brightness (0 = neutral, 0.2 = clearly yellow) */
export const warmth = ({ r, g, b }) => ((r + g) / 2 - b) / Math.max(1, (r + g + b) / 3);

/* the channel gains that bring `gen` toward `ref`'s balance (or toward neutral), part of the way, never extreme */
export function gains(gen, ref = null, part = 0.7) {
  const L = (x) => Math.max(1, (x.r + x.g + x.b) / 3), tgt = ref || { r: L(gen), g: L(gen), b: L(gen) };
  const k = (c) => { const want = (tgt[c] / L(tgt)) / Math.max(1e-3, gen[c] / L(gen)); return Math.min(1.25, Math.max(0.8, 1 + (want - 1) * part)); };
  const o = { r: k('r'), g: k('g'), b: k('b') }, keep = (gen.r + gen.g + gen.b) / Math.max(1, o.r * gen.r + o.g * gen.g + o.b * gen.b); /* same brightness */
  return { r: o.r * keep, g: o.g * keep, b: o.b * keep };
}

/* → { buf, fixed, warmth, refWarmth } ; refFile: the product photo the picture was made from (optional) */
export async function balanceWarm(buf, refFile = null, { log = console } = {}) {
  try {
    const gen = await meanRGB(buf), w = warmth(gen);
    let ref = null; if (refFile) { try { ref = await meanRGB(fs.readFileSync(refFile)); } catch { ref = null; } }
    const rw = ref ? warmth(ref) : null;
    const tooWarm = ref ? w - rw > 0.1 && w > 0.1 : w > 0.22;
    if (!tooWarm) return { buf, fixed: false, warmth: w, refWarmth: rw };
    const k = gains(gen, ref), jpeg = buf[0] === 0xff && buf[1] === 0xd8, webp = buf.slice(8, 12).toString() === 'WEBP'; /* the same format out as in */
    const out = await run(['-v', 'error', '-i', 'pipe:0', '-vf', `colorchannelmixer=rr=${k.r.toFixed(3)}:gg=${k.g.toFixed(3)}:bb=${k.b.toFixed(3)}`, '-frames:v', '1', '-f', 'image2', ...(jpeg ? ['-c:v', 'mjpeg', '-q:v', '2'] : webp ? ['-c:v', 'libwebp', '-quality', '92'] : ['-c:v', 'png']), 'pipe:1'], buf);
    if (!out?.length) return { buf, fixed: false, warmth: w, refWarmth: rw };
    log.info?.('[color] softened a warm cast', w.toFixed(2), rw == null ? '(no ref)' : `vs ${rw.toFixed(2)}`);
    return { buf: out, fixed: true, warmth: w, refWarmth: rw };
  } catch (e) { log.warn?.('[color] check skipped', String(e.message).slice(0, 120)); return { buf, fixed: false }; }
}
