// QV round 2 (HTTP): compressed answers are final once handed to async compression; a status set without writeHead still
// goes out with its headers; the cross-site guard covers every sign-in cookie.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { zipRes } from '../http-zip.js';

const serve = (handler) => new Promise((ok) => { const srv = http.createServer((req, res) => { zipRes(req, res); handler(req, res); }); srv.listen(0, '127.0.0.1', () => ok(srv)); });
const get = (srv, path = '/') => new Promise((ok, no) => { http.get({ host: '127.0.0.1', port: srv.address().port, path, headers: { 'accept-encoding': 'br' } }, (r) => { const ch = []; r.on('data', (c) => ch.push(c)); r.on('end', () => ok({ status: r.statusCode, headers: r.headers, body: Buffer.concat(ch) })); }).on('error', no); });
const big = JSON.stringify({ x: 'y'.repeat(80000) });

test('a big answer compressed off the main thread wins over a later error answer', async () => {
  let late = null;
  const srv = await serve((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(big); try { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"late"}'); } catch (e) { late = e; } });
  const r = await get(srv); srv.close();
  assert.equal(r.status, 200); assert.equal(r.headers['content-encoding'], 'br'); assert.equal(zlib.brotliDecompressSync(r.body).toString(), big); void late;
});

test('a status and headers set without writeHead still go out (small and big bodies)', async () => {
  const srv = await serve((req, res) => { res.statusCode = req.url === '/r' ? 302 : 200; if (req.url === '/r') res.setHeader('location', '/x'); res.setHeader('content-type', 'application/json'); res.end(req.url === '/big' ? big : req.url === '/r' ? undefined : '{"ok":true}'); });
  const a = await get(srv, '/small'), b = await get(srv, '/big'), c = await get(srv, '/r'); srv.close();
  assert.equal(a.status, 200); assert.equal(a.body.toString(), '{"ok":true}');
  assert.equal(b.status, 200); assert.equal(zlib.brotliDecompressSync(b.body).toString(), big);
  assert.equal(c.status, 302); assert.equal(c.headers.location, '/x');
});

test('the cross-site guard looks at every sign-in cookie, never excuses a bearer header, and the webhook exemption is exact', () => {
  const s = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(s, /\(\?:fs_s\|brew_demo\)=/); assert.doesNotMatch(s.slice(s.indexOf('const crossSite'), s.indexOf('async function serve')), /Bearer/);
  assert.match(s, /shopify\\\/webhooks\)\(\?:\\\/\|\$\)/);
});
