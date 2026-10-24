// Compressed answers: every text answer over 1 KB goes out brotli or gzip. A big one (the feed is ~400 KB) is compressed off the
// main thread; once handed over it is final, so a late writeHead/write/end never replaces or corrupts it. Streams (server-sent
// events, the jam's reply) write before they end and pass through as they are.
import zlib from 'node:zlib';

export const ZTYPE = /^(application\/(json|javascript)|text\/(html|javascript|plain|css))/;
export const encOf = (req) => { const ae = String(req.headers['accept-encoding'] || ''); return /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null; };
export const zipAsync = (buf, enc, level) => new Promise((ok, no) => (enc === 'br' ? zlib.brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level ?? 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }, (e, z) => (e ? no(e) : ok(z))) : zlib.gzip(buf, { level: level ?? 6 }, (e, z) => (e ? no(e) : ok(z)))));
export const zip = (buf, enc, level) => (enc === 'br' ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level ?? 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }) : zlib.gzipSync(buf, { level: level == null ? 6 : Math.min(9, level) }));
export const zipRes = (req, res) => {
  const enc = encOf(req); if (!enc) return;
  const wh = res.writeHead, wr = res.write, en = res.end; let held = null;
  const flush = () => { if (held) { const h = held; held = null; wh.apply(res, h); } };
  res.writeHead = function (...a) { if (sent) return res; held = a; return res; };
  let sent = false; /* an answer handed to async compression is final: a later writeHead/write/end is ignored, as Node would refuse it */
  res.write = function (...a) { if (sent) return false; if (!held && !res.headersSent) held = [res.statusCode]; /* a status set without writeHead */ flush(); return wr.apply(res, a); };
  res.end = function (body, ...rest) {
    if (sent) return res;
    if (!held && !res.headersSent) held = [res.statusCode]; /* res.statusCode + setHeader + end, no writeHead: still sent with its headers */
    if (held && (typeof body === 'string' || Buffer.isBuffer(body))) {
      const [code] = held, hd = held.find((x, i) => i > 0 && x && typeof x === 'object') || {}, get = (k) => Object.entries(hd).find(([x]) => x.toLowerCase() === k)?.[1] ?? res.getHeader(k);
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, typeof rest[0] === 'string' ? rest[0] : 'utf8');
      if (code === 200 && buf.length > 1024 && !get('content-encoding') && ZTYPE.test(String(get('content-type') || ''))) {
        const out = Object.fromEntries(Object.entries(hd).filter(([x]) => x.toLowerCase() !== 'content-length')), cb = rest.filter((x) => typeof x === 'function');
        const send = (z) => { res.removeHeader('content-length'); wh.call(res, code, { ...out, 'content-encoding': enc, vary: 'Accept-Encoding', 'content-length': z.length }); en.call(res, z, ...cb); };
        held = null; sent = true;
        /* a big answer (the feed is ~400 KB) is compressed off the main thread, so one request's compression never holds the others */
        if (buf.length > 32 * 1024) { zipAsync(buf, enc).then(send).catch((e) => { try { if (!res.headersSent) { wh.call(res, code, hd); en.call(res, buf, ...cb); } } catch {} console.warn('[zip]', e.message); }); return res; }
        sent = false; send(zip(buf, enc)); return res;
      }
    }
    flush(); return en.call(res, body, ...rest);
  };
};
