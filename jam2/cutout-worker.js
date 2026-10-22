// The free background cut-out, off the main thread. The library's mask work is plain JavaScript over every pixel: run in
// the server's own thread, a batch (Do it for every product) starved every other request until Cloud Run answered 429.
// One worker, one photo at a time; each photo is shrunk to 1600 px first (the cut-out is placed far smaller than that).
import { parentPort } from 'node:worker_threads';
import sharp from 'sharp';

let lib = null;
parentPort.on('message', async ({ id, buf }) => {
  try {
    lib ||= await import('@imgly/background-removal-node');
    const small = await sharp(Buffer.from(buf)).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const blob = await lib.removeBackground(new Blob([small], { type: 'image/png' }), { output: { format: 'image/png' } });
    const out = Buffer.from(await blob.arrayBuffer());
    parentPort.postMessage({ id, ok: true, buf: out }, [out.buffer]);
  } catch (e) { parentPort.postMessage({ id, ok: false, error: e.message }); }
});
