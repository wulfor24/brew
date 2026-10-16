// A page-relative image path → a file on disk, never outside public/ or a brand pack's assets.
// "assets/../../server.js", "/proc/self/environ", backslashes and NULs resolve to null (the publish pack and the image guard read these files).
import path from 'node:path';
export const makePhotoFile = (PUB, BRANDS_DIR) => (rel) => {
  const r = String(rel || '').replace(/^\/+/, '').replace(/[?#].*$/, '');
  if (!r || /\.\.|\\|\0/.test(r)) return null;
  const m = /^b\/([a-z0-9-]+)\/a\/([\w.-]+)$/.exec(r);
  if (m) return path.join(BRANDS_DIR, m[1], 'assets', m[2]);
  const f = path.resolve(PUB, r);
  return f.startsWith(PUB + path.sep) ? f : null;
};
