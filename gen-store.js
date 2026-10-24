// Generated creatives (public/gen/*.png) outlive the container: every new file is copied to GCS (gen/<name>),
// and a file missing on this instance's disk is fetched back from GCS on first request.
// Without this, a restart or redeploy leaves saved versions pointing at images that no longer exist.
// The copy is retried with backoff, and genFlush() waits for every copy still in flight, so a card or draft that names a
// file is only saved once the file is in the bucket (another instance can serve it the moment the card shows).
// Research media (rival ad posters and videos, story pictures: public/research/<sha>.jpg, served as /research/<file>) is
// shared by every brand and instance the same way (research-media/<file>): researchFile() fetches it from the bucket on a
// miss, whichever brand the request came for.
import fs from 'node:fs';
import path from 'node:path';

let cfg = null; // { dir, bucket, gToken, log }
export const configureGen = (c) => { cfg = c; fs.mkdirSync(c.dir, { recursive: true }); if (c.researchDir) fs.mkdirSync(c.researchDir, { recursive: true }); };
const remote = () => (cfg?.remote != null ? !!cfg.remote : !!(process.env.K_SERVICE && cfg?.bucket && cfg?.gToken)); /* remote/gcs can be set in tests */
const ok = (name) => /^[a-z0-9_-]{6,64}\.(png|jpg|wav|mp4|zip|pdf|srt|gif)$/i.test(name); /* pdf: the team brief (team-brief.js); srt, gif: a Studio film's captions and loop (video-finish.js) */
const CT = { png: 'image/png', jpg: 'image/jpeg', wav: 'audio/wav', mp4: 'video/mp4', zip: 'application/zip' };

const gcs = async (method, name, buf, prefix = 'gen/') => {
  if (cfg.gcs) return cfg.gcs(method, prefix + name, buf);
  const tk = await cfg.gToken(), obj = prefix + name;
  const url = method === 'PUT'
    ? `https://storage.googleapis.com/upload/storage/v1/b/${cfg.bucket}/o?uploadType=media&name=${encodeURIComponent(obj)}`
    : `https://storage.googleapis.com/storage/v1/b/${cfg.bucket}/o/${encodeURIComponent(obj)}?alt=media`;
  const r = await fetch(url, { method: method === 'PUT' ? 'POST' : 'GET', headers: { authorization: `Bearer ${tk}`, ...(buf ? { 'content-type': CT[name.split('.').pop().toLowerCase()] || 'application/octet-stream' } : {}) }, body: buf, signal: AbortSignal.timeout(60e3) });
  if (!r.ok) throw new Error(`gcs ${method} ${obj} ${r.status}`);
  return method === 'PUT' ? true : Buffer.from(await r.arrayBuffer());
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pending = new Map(); // name → the upload in flight
/* one upload, tried up to 4 times (1 s, 4 s, 16 s apart): a blip at GCS never leaves a card pointing at a file only this instance has */
const upload = async (name, buf) => {
  for (let i = 0; ; i++) {
    try { return await gcs('PUT', name, buf); }
    catch (e) { if (i >= 3) { cfg.log?.warn?.('[gen] gcs upload failed', name, e.message); return false; } await sleep((cfg.backoffMs ?? 1000) * 4 ** i); }
  }
};

// write a generated image locally and (on Cloud Run) to the bucket
export const saveGen = (name, buf) => {
  fs.writeFileSync(path.join(cfg.dir, name), buf);
  if (!remote()) return;
  const job = upload(name, buf).finally(() => { if (pending.get(name) === job) pending.delete(name); });
  pending.set(name, job);
};
// wait for the uploads in flight (all, or the names given) before a file that names them is saved
export const genFlush = async (names = null) => { const jobs = names ? names.map((n) => pending.get(String(n).replace(/^\/?gen\//, ''))).filter(Boolean) : [...pending.values()]; await Promise.all(jobs); };

// the static server calls this for /gen/<file>; null means the image is gone everywhere
export const genFile = async (name) => {
  if (!ok(name)) return null;
  const f = path.join(cfg.dir, name); if (fs.existsSync(f)) return f;
  if (!remote()) return null;
  try { fs.writeFileSync(f, await gcs('GET', name)); return f; } catch { return null; }
};

/* research media, shared by every brand: this instance's disk, then the bucket (research-media/, then the older media/) */
export const researchFile = async (name) => {
  if (!/^[a-f0-9]{20}\.(jpg|png|mp4)$/.test(String(name || ''))) return null;
  const dir = cfg?.researchDir; if (!dir) return null;
  const f = path.join(dir, name); if (fs.existsSync(f)) return f;
  if (!remote()) return null;
  for (const prefix of ['research-media/', 'media/']) { try { const b = await gcs('GET', name, null, prefix); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, b); return f; } catch {} }
  return null;
};

