// Every first draft is a picture we would show a founder: one real-looking photograph of what the card is about, never a
// collage. 25 Oct (Param, Arata): a feed card showed a hair swatch on white beside three Damage Defence bottles pasted over a dark
// panel that ran off the frame, with jagged edges. Three causes, each closed here for every brand and every caller:
//   1. the reference was a designed store card (an infographic, a banner, a swatch collage) and the model copied it as a
//      paste-up: plainest() picks the product's cleanest photo (a packshot on a plain ground) as the reference;
//   2. nothing judged the picture once made: lookVerdict() reads the vision judge's answer (server.js draftLooks) and
//      collageEdges() is a free pixel check for the plainest paste-up sign, two flat backdrops of different colours at the frame;
//   3. the Studio's fallback pasted a cut-out that never came free of its background: cutQuality() says when a cut-out is a
//      rectangle (no matte) or has a stair-stepped, unsmoothed edge, and such a cut-out is never placed.
// image-guard.js runs the checks after every picture: a failure is made once more with the reason, and a second failure is held
// back (the real product photo stands in, marked genFailed, and the caller remakes it later). Pure functions; sharp only.
import sharp from 'sharp';

// quality version: drafts and watcher pictures saved before it are judged once (drafts-bg healLooks, feed-service housekeep)
export const LOOKS_V = 1;
const N = 64, SEG = 8;

/* the picture shrunk to N×N, transparency on white (a see-through packshot reads as a plain ground) */
async function grid(input) {
  const { data, info } = await sharp(input).rotate().flatten({ background: '#ffffff' }).resize(N, N, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, ch: info.channels };
}
/* the frame's edge as runs of SEG pixels (two pixels deep), each with its mean colour and spread */
function edgeRuns({ data, ch }) {
  const px = (x, y) => { const i = (y * N + x) * ch; return [data[i], data[i + 1], data[i + 2]]; };
  const lines = [[0, 1].map((d) => Array.from({ length: N }, (_, x) => [x, d])), [0, 1].map((d) => Array.from({ length: N }, (_, x) => [x, N - 1 - d])),
    [0, 1].map((d) => Array.from({ length: N }, (_, y) => [d, y])), [0, 1].map((d) => Array.from({ length: N }, (_, y) => [N - 1 - d, y]))];
  const runs = [];
  for (const [a, b] of lines) for (let s = 0; s < N; s += SEG) {
    const pts = [...a.slice(s, s + SEG), ...b.slice(s, s + SEG)].map(([x, y]) => px(x, y)), mean = [0, 1, 2].map((k) => pts.reduce((t, p) => t + p[k], 0) / pts.length);
    const spread = Math.max(...[0, 1, 2].map((k) => Math.sqrt(pts.reduce((t, p) => t + (p[k] - mean[k]) ** 2, 0) / pts.length)));
    runs.push({ mean, spread });
  }
  return runs;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const FLAT = 2.5;

/* how plain a photo's ground is, 0 … 1: the share of its edge that is one flat colour. A packshot on white or on a see-through
   ground is near 1; a lifestyle shot, an infographic or a banner with words and panels at its edges is far lower */
export async function plainness(input) {
  try { const runs = edgeRuns(await grid(input)), flat = runs.filter((r) => r.spread <= FLAT); if (!flat.length) return 0;
    const groups = []; for (const r of flat) { const g = groups.find((x) => dist(x.mean, r.mean) < 24); if (g) g.n++; else groups.push({ mean: r.mean, n: 1 }); }
    return Math.max(...groups.map((g) => g.n)) / runs.length; } catch { return 0; }
}
/* the cleanest reference among a product's photos (its main photo first, then the other views): the plainest ground wins when it is
   clearly plainer; files is [{ key, file }] and the key of the pick comes back. A single photo is its own pick */
export async function plainest(files = []) {
  const ok = files.filter((x) => x?.file); if (ok.length < 2) return ok[0]?.key ?? null;
  const scored = await Promise.all(ok.map(async (x, i) => ({ ...x, i, p: await plainness(x.file) })));
  const best = scored.reduce((a, b) => (b.p > a.p + 0.15 ? b : a), scored[0]); /* the main photo keeps its place unless another is clearly plainer */
  return best.key;
}
/* the plainest paste-up sign, free: two flat grounds of clearly different colours at the frame's edge (a product on white beside a
   dark panel, a swatch on white beside a coloured card). A real photograph's edge is never two flat colours */
export async function collageEdges(input) {
  try { const runs = edgeRuns(await grid(input)), flat = runs.filter((r) => r.spread <= FLAT), groups = [];
    for (const r of flat) { const g = groups.find((x) => dist(x.mean, r.mean) < 40); if (g) g.n++; else groups.push({ mean: r.mean, n: 1 }); }
    const big = groups.filter((g) => g.n / runs.length >= 0.1).sort((a, b) => b.n - a.n);
    const two = big.length >= 2 && dist(big[0].mean, big[1].mean) >= 60;
    return { collage: two, why: two ? 'two flat backgrounds of different colours meet the frame (a paste-up)' : '' }; } catch { return { collage: false, why: '' }; }
}

/* a cut-out (a PNG with transparency): is it a real matte? rect: the opaque part fills its whole box (the background never came
   off, so a photo's dark or white panel would be pasted with it); jagged: its edge is all hard steps (no soft pixels), so it reads
   pixelated over any scene. Returns { ok, rect, jagged, why } */
export async function cutQuality(input) {
  try {
    const img = sharp(input), m = await img.metadata(); if (!m.hasAlpha) return { ok: false, rect: true, jagged: false, why: 'the cut-out has no transparency' };
    const W = Math.min(400, m.width || 400), { data, info } = await sharp(input).ensureAlpha().resize({ width: W, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height, ch = info.channels, a = (x, y) => data[(y * w + x) * ch + 3];
    let x0 = w, y0 = h, x1 = -1, y1 = -1, solid = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a(x, y) > 127) { solid++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    if (x1 < 0) return { ok: false, rect: false, jagged: false, why: 'the cut-out is empty' };
    const fill = solid / ((x1 - x0 + 1) * (y1 - y0 + 1));
    let edge = 0, soft = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const v = a(x, y); if (v <= 127) continue;
      if (a(x - 1, y) <= 127 || a(x + 1, y) <= 127 || a(x, y - 1) <= 127 || a(x, y + 1) <= 127) { edge++; const n = [a(x - 1, y), a(x + 1, y), a(x, y - 1), a(x, y + 1), v]; if (n.some((q) => q > 8 && q < 247)) soft++; } }
    const rect = fill > 0.985, jagged = edge > 40 && soft / edge < 0.08;
    return { ok: !rect && !jagged, rect, jagged, fill: +fill.toFixed(3), soft: edge ? +(soft / edge).toFixed(3) : 0, why: rect ? 'the background never came off (the cut-out is a rectangle)' : jagged ? 'the cut-out edge is jagged (no soft pixels)' : '' };
  } catch (e) { return { ok: false, rect: false, jagged: false, why: `the cut-out could not be read (${e.message})` }; }
}

/* the vision judge's question (server.js draftLooks asks it with the picture). words: what the card says it shows */
export const lookPrompt = (words = '') => `This is a first-draft ad picture for a card in a brand's feed.${String(words).trim() ? ` The card says: "${String(words).replace(/\s+/g, ' ').trim().slice(0, 500)}".` : ''}
Judge only the picture. Reply with one word, then a short reason.
GOOD: one coherent photograph (or a clean product shot) that shows what the card is about.
COLLAGE: it looks pasted together: cut-out products with hard or jagged edges, flat panels or blocks of colour behind or beside them, two backgrounds meeting, a blank band or border, or a copy of a designed store graphic.
CROPPED: the product or the main subject is cut off by the frame edge.
OFFTOPIC: it shows something the card is not about (another product type, an unrelated scene).`;
/* the judge's reply → { ok, verdict, why }; no clear word → null (the check didn't answer: never counted as a failure) */
export function lookVerdict(text = '') {
  const t = String(text || '').trim(), m = /^\W*(good|collage|cropped|offtopic|off-topic)\b/i.exec(t); if (!m) return null;
  const v = m[1].toLowerCase().replace('-', ''); return { ok: v === 'good', verdict: v, why: t.slice(0, 200) };
}
/* the line added to the prompt when a picture is made again after failing */
export const FIX = {
  collage: 'The last picture looked like a collage. Make ONE real photograph: the product physically in the scene with true contact shadows, a single continuous background, no panels, blocks, borders, bands, swatches or cut-out edges, and nothing copied from a designed graphic.',
  cropped: 'The last picture cut the product off at the frame edge. Keep the whole product inside the frame with space around it.',
  offtopic: 'The last picture did not show what the card is about. Show exactly the product and the moment the card names.',
};
