// Brew prototype server: read → moves → feed → jam → share the brief.
// Serves public/ and a few /api routes: live Claude text, live Gemini (Vertex) images,
// dummy Slack. Keys come from an env file (ENV_FILE, default ../ugc-factory/.env) and are never sent to the page.
import { createJamMail } from './jam-mail.js';
import { configureGen, saveGen, genFile, researchFile } from './gen-store.js';
import http from 'node:http';
import { safeFetch } from './reader/util.js'; // photo links reach only the public internet
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeLLM, PROVIDER } from './gemini-client.js';
import { createFeedService } from './feed-service.js';
import { createResearch } from './research.js';
import { createLiveWatch } from './live-watch.js';
import { createStore } from './store.js';
import { B, BN, runIn, liveRe, setDefaultBrand, inBrand } from './brand-ctx.js';
import { createImageGuard } from './image-guard.js';
import { createPacks, slugOf, DEFAULT } from './brand-pack.js';
import { createAI, aiPaused, billingError, noteBilling } from './ai.js';
import { createTreg, gcsCache } from './treg.js';
import { setApifyCache } from './apify.js';
import { chain as mediaChain, sloosh, slooshOn, openaiImage as openaiImageRaw } from './media.js';
import { createBuilder, blocked, clientIp } from './build.js';
import { createRetire } from './retire.js'; // older revisions stop and exit; brands being reset are hidden
import { createFactsDesk } from './facts-desk.js';
import { createAuth } from './auth.js';
import { createConnectors } from './connectors/index.js';
import { DEMO, demoSid, demoEmail, runDemo, sessionOf, guardFetch } from './demo-mode.js'; // Demo Mode: the demo site (DEMO_MODE=1)
import { createDemoRoutes } from './demo-routes.js';
import { launchBrowser, zipBuffer } from './pdf/render.js';
import { thinkModel, prefs } from './model-ctx.js';
import { createBrandMemory, vertexEmbedder, memoryHooks } from './brand-memory.js'; // brand memory
import { createMemoryRoutes } from './memory-routes.js'; // brand memory
import { createMovesScheduler } from './moves-cadence.js'; // audit, listening and automation moves, weekly
import { createLearnings, briefView } from './brand-learnings.js'; // /update-brand-learnings: a pasted call, notes or emails → brief, memory, moves
import { createDraftsBg } from './drafts-bg.js'; // first drafts on the top cards, in the background
import { createCardsGen } from './cards-gen.js';
import { setMemoryHooks } from './learn.js'; // brand memory
import { createNotes } from './notes.js'; // margin notes for any brand's cards
import { createValue } from './value.js'; // move grades for the ranker
import { createSocialScheduler, heardView, forgetSocial } from './social-feed.js'; // background listening + ideas stream
import { createListenWatch } from './listen-watch.js'; // What we heard: every quote, asked threads, daily history
import { spendLedger } from './treg.js'; // per-brand treg spend, spend/<YYYY-MM>.json
import { createPulse } from './market-pulse.js'; // market numbers: demand, search, AI answers, rival ads, prices, weather
import { createCalendar } from './calendar.js'; // holidays, festivals and sale days for the brand's own markets
import { createVideoRead } from './video-read.js'; // what a video does: hook, scenes, CTA (Gemini on Vertex)
import { watchCatalog } from './treg-map.js'; // new treg tools since last week, for admins

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const GEN = path.join(PUB, 'gen');
fs.mkdirSync(GEN, { recursive: true });

// ---------- env ----------
const envFile = process.env.ENV_FILE || path.join(ROOT, '..', 'ugc-factory', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const PORT = +process.env.PORT || 4200;
guardFetch(console); // Demo Mode only: no write to a real account, no real message
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODELS = [process.env.FEED_CLAUDE_MODEL || 'claude-sonnet-5-5', 'claude-sonnet-5'];
const GPROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'squareup-492617';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
let MOCK = process.env.AI_MOCK === '1' || (PROVIDER === 'anthropic' && !ANTHROPIC_KEY); // Gemini needs only Google sign-in
const CAPS = { text: +process.env.DAILY_TEXT_CAP || 400, image: +process.env.DAILY_IMAGE_CAP || 60, video: +process.env.DAILY_VIDEO_CAP || 15, voice: +process.env.DAILY_VOICE_CAP || 60 };
const used = { day: new Date().toDateString(), text: 0, image: 0, video: 0, voice: 0 };
const spend = (k) => { const d = new Date().toDateString(); if (used.day !== d) Object.assign(used, { day: d, text: 0, image: 0, video: 0, voice: 0 }); if (used[k] >= CAPS[k]) return false; used[k]++; if (USAGE) saveUsage(); return true; };
// the system prompt is the active brand's brief (the generated brief.md)
const SYSTEM = () => B()?.system || '';

// ---------- guardrails ----------
const BANNED = liveRe((b) => b.bannedRe); // the claim words this brand's category can't use
const clean = (s) => String(s || '').replace(/—/g, ',').replace(/ ,/g, ',');

// ---------- Claude ----------
// Sonnet 5.5 for live latency. Thinking off (`between_tools`, valid at effort high or below) and low effort,
// so short card copy comes back in a few seconds instead of spending max_tokens on reasoning.
// Refusals fall back server-side (`fallbacks: "default"`).
const anthropic = makeLLM({ apiKey: ANTHROPIC_KEY }); // Claude, or Gemini on Vertex while we build (gemini-client.js)
const claudeParams = (messages, max) => ({
  model: thinkModel(CLAUDE_MODELS[0]), max_tokens: max, system: SYSTEM(), messages, // the jam's model chip (Auto / Deep / Fast)
  thinking: { type: 'between_tools' }, output_config: { effort: 'low' },
  betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'
});
const textOf = (msg) => msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
/* the jam's own calls share ai.js's pause: no call while the credit is out, and a billing failure starts the pause */
const claudeCreate = async (params) => { if (aiPaused()) throw billingError(); try { return await anthropic.beta.messages.create(params); } catch (e) { if (noteBilling(e)) throw billingError(); throw e; } };
const claudeJSON = async (prompt, max = 2000) => {
  const msg = await claudeCreate(claudeParams([{ role: 'user', content: prompt + '\n\nReply with JSON only, no prose, no code fences.' }], max));
  if (msg.stop_reason === 'refusal') throw new Error('refused: ' + (msg.stop_details?.category || 'unknown'));
  const t = textOf(msg);
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); }
  catch (e) { console.error('[claudeJSON]', msg.model, msg.stop_reason, t.slice(0, 400)); throw e; }
};
// Structured output: the reply is constrained to a JSON schema (output_config.format), so it always parses,
// Hindi, quotes and all. Sonnet 5.5 rejects forced tool_choice, so this is the reliable path.
const strictSchema = (x) => {
  if (Array.isArray(x)) return x.map(strictSchema);
  if (!x || typeof x !== 'object') return x;
  const o = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'properties' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, strictSchema(pv)])) : strictSchema(v)]));
  if (o.type === 'object') o.additionalProperties = false;
  /* structured output rejects these ("property 'maxItems' is not supported"): limits live in the descriptions instead */
  for (const k of ['maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'maxProperties', 'minProperties', 'uniqueItems']) delete o[k];
  if (o.minItems > 1) delete o.minItems;
  return o;
};
const claudeTool = async (prompt, schema, max = 3000, name = 'reply') => {
  const msg = await claudeCreate({ ...claudeParams([{ role: 'user', content: prompt }], max), output_config: { effort: 'low', format: { type: 'json_schema', schema: strictSchema(schema) } } });
  if (msg.stop_reason === 'refusal') throw new Error('refused: ' + (msg.stop_details?.category || 'unknown'));
  if (msg.stop_reason === 'max_tokens') console.warn('[claudeTool]', name, 'hit max_tokens', max);
  const t = textOf(msg);
  try { return JSON.parse(t); } catch (e) { console.error('[claudeTool]', name, msg.stop_reason, t.slice(0, 300)); throw e; }
};
// the active brand's fact sheet: every number Claude writes must come from it, or QA drops the card
const FACT_BRIEF = () => B()?.factBrief || '';
const cardBrief = (c, role) => `${FACT_BRIEF()}\n\nCard (by the ${c.agent} agent, from ${c.src || 'the move documents'}):\nTitle: ${c.title}\nBody: ${c.sub}\n${(c.rows || []).map((r) => `- ${r[0]}: ${r[1]}`).join('\n')}\nThe person reading is the ${role || 'founder'}.`;

// ---------- Vertex Gemini image ----------
let tok = { v: '', exp: 0 };
async function gToken() {
  if (tok.v && Date.now() < tok.exp) return tok.v;
  if (process.env.K_SERVICE) { // Cloud Run: metadata server
    const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
    const j = await r.json(); tok = { v: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 }; return tok.v;
  }
  const v = await new Promise((res, rej) => execFile('gcloud', ['auth', 'print-access-token'], { timeout: 15000 }, (e, out, err) => e ? rej(new Error(String(err || e.message).trim())) : res(out.trim())));
  tok = { v, exp: Date.now() + 40 * 60 * 1000 }; return v;
}
/* Vertex (Google ADC, never treg): the model asked for, then the other Gemini image model when it fails (an outage, a quota,
   or a reply with no picture in it), so one model's bad minute never costs a draft its picture */
const IMAGE_FALLBACK = process.env.GEMINI_IMAGE_FALLBACK || 'gemini-2.5-flash-image';
async function geminiOnce({ srcFile, prompt, ratio, model }) {
  const t = await gToken();
  const parts = [];
  if (srcFile) { const b = fs.readFileSync(srcFile); parts.push({ inlineData: { mimeType: IMG_MIME(b), data: b.toString('base64') } }); }
  parts.push({ text: prompt });
  const url = `https://aiplatform.googleapis.com/v1/projects/${GPROJECT}/locations/global/publishers/google/models/${model}:generateContent`;
  const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'x-goog-user-project': GPROJECT, 'content-type': 'application/json' }, signal: AbortSignal.timeout(120e3),
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio || '1:1' } } }) });
  if (!r.ok) throw new Error(`Gemini ${model} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const img = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!img) throw new Error(`Gemini ${model} returned no image (${j.candidates?.[0]?.finishReason || 'no reason'})`);
  return Buffer.from(img.data, 'base64');
}
async function rawGeminiImage(o) {
  const models = [...new Set([o.model || IMAGE_MODEL, IMAGE_FALLBACK, IMAGE_MODEL])];
  let last; for (const model of models) { try { return await geminiOnce({ ...o, model }); } catch (e) { last = e; console.warn('[image] model failed', e.message.slice(0, 200)); } }
  throw last;
}
/* every generated picture shows the right product (image-guard.js): the product the words name is the reference,
   and a vision check after each picture regenerates or falls back to the real photo on a mismatch */
const IMG_MIME = (b) => (b[0] === 0x89 ? 'image/png' : b[0] === 0xff ? 'image/jpeg' : b.slice(0, 4).toString() === 'RIFF' ? 'image/webp' : b.slice(0, 3).toString() === 'GIF' ? 'image/gif' : 'image/jpeg');
const photoAny = async (u) => { if (!u) return null; if (/^https?:/.test(u)) { const f = path.join(os.tmpdir(), 'brew-ph-' + crypto.createHash('sha1').update(u).digest('hex').slice(0, 16)); if (!fs.existsSync(f)) { const r = await safeFetch(u, { signal: AbortSignal.timeout(20e3) }); if (!r.ok) return null; fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } return f; } return photoAsync(u); };
const sameProduct = async (refFile, buf, name) => {
  if (!anthropic || process.env.AI_MOCK === '1' || process.env.IMAGE_CHECK === '0') return { same: true, why: 'check off' };
  const ref = fs.readFileSync(refFile), img = (b) => ({ type: 'image', source: { type: 'base64', media_type: IMG_MIME(b), data: b.toString('base64') } });
  const msg = await anthropic.messages.create({ model: process.env.IMAGE_CHECK_MODEL || 'claude-haiku-5-5', max_tokens: 400, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: [
    { type: 'text', text: `Image 1 is the real product${name ? ` (${name})` : ''}. Image 2 is a new ad picture. Does image 2 show the same product as image 1: the same model, colours, prints and details, not a different product from the range? Ignore the scene, angle and light. Reply with one word, SAME or DIFFERENT, then a short reason.` },
    img(ref), img(buf)] }] });
  const t = (msg.content || []).map((x) => x.text || '').join(' ').trim(); if (!/^\W*(same|different)\b/i.test(t)) throw new Error(`no verdict (${msg.stop_reason})`); return { same: /^\W*same\b/i.test(t), why: t.slice(0, 160) };
};
/* the image chain (media.js): Sloosh once connected, then Vertex Gemini (both models), then OpenAI gpt-image-1; the jam's
   image chip puts GPT Image first when it is picked */
const openaiImage = (o) => openaiImageRaw(o, { readFile: (f) => fs.readFileSync(f) });
const rawImage = async (o, { gptFirst = false } = {}) => {
  const steps = [['sloosh', slooshOn() && (() => sloosh('image', { prompt: o.prompt, ratio: o.ratio, src: o.srcFile ? fs.readFileSync(o.srcFile) : null }))], ['gemini', () => rawGeminiImage(o)], ['gpt-image', OPENAI_KEY && (() => openaiImage(o))]];
  if (gptFirst) steps.splice(1, 0, steps.splice(2, 1)[0]);
  return (await mediaChain('image', steps, console)).buf;
};
const geminiImage = createImageGuard({ gen: (o) => rawImage(o), verify: sameProduct, fetchPhoto: photoAny, resolve: (f) => resolveLocal(f), context: inBrand, log: console });
const imageGen = createImageGuard({ gen: (o) => rawImage(o, { gptFirst: prefs().image === 'gpt-image' && !!OPENAI_KEY && !!o.srcFile }), verify: sameProduct, fetchPhoto: photoAny, resolve: (f) => resolveLocal(f), context: inBrand, log: console });

// ---------- mock replies (free, used when AI is off or fails) ----------
// three cuts of the card itself when the writer is off: its own numbers, its reason, a smaller first step.
// Never canned ads (those carried stale prices and had nothing to do with the card)
const cutAt = (x, n) => { x = String(x || '').trim().replace(/\s+/g, ' '); if (x.length <= n) return x; const y = x.slice(0, n); return y.slice(0, Math.max(y.lastIndexOf(' '), n - 15)).replace(/[,;:]$/, '') + '…'; };
const mockVariants = (c) => { const sub = String(c.sub || '').trim(), first = sub.split(/(?<=[.!?])\s+/)[0] || sub, why = (c.detail?.why || [])[0] || '', how = (c.detail?.how || [])[0] || '';
  return [
    { angle: 'Number first', title: cutAt(c.title, 70), sub: cutAt(sub, 220) },
    { angle: 'Lead with why', title: cutAt(why || first, 70), sub: cutAt([why ? first : '', how || sub].filter(Boolean).join(' '), 220) },
    { angle: 'Smaller first step', title: cutAt(c.cta?.label ? `${c.cta.label}, one week first` : 'Start with one, then scale', 70), sub: cutAt(how ? `${how} Run it small for a week, read the number, then go wider.` : `${first} Run it small for a week, read the number, then go wider.`, 220) }
  ].filter((v) => v.title); };

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.zip': 'application/zip', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
// files, with byte ranges so story videos can seek and play on Safari.
// Text files (js, css, html, svg, json) are compressed once per version and kept in memory, with an ETag so a reload
// gets a 304; the page asks for them as name?v=<hash> (pageFor), and those answers are cached for a year.
const ZTEXT = /\.(js|css|html|svg|json|webmanifest|txt|md)$/;
const ZC = new Map(); // file → { mtime, size, etag, raw, br, gzip }
const fileEntry = (f) => { const st = fs.statSync(f); const e0 = ZC.get(f); if (e0 && e0.mtime === st.mtimeMs && e0.size === st.size) return e0;
  const raw = fs.readFileSync(f), e = { mtime: st.mtimeMs, size: st.size, raw, etag: `"${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 16)}"` }; ZC.set(f, e); return e; };
const encOf = (req) => { const ae = String(req.headers['accept-encoding'] || ''); return /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null; };
const zip = (buf, enc, level) => (enc === 'br' ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level ?? 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }) : zlib.gzipSync(buf, { level: level == null ? 6 : Math.min(9, level) }));
const verOf = (f) => { try { return fileEntry(f).etag.slice(1, 9); } catch { return null; } };
const serveFile = (req, res, f, o = {}) => {
  const type = TYPES[path.extname(f)] || 'application/octet-stream', st = fs.statSync(f), size = st.size;
  const pinned = o.immutable || /[?&]v=/.test(req.url || '') || /\/(research|gen)\//.test(f); // a versioned or content-named file never changes
  const cache = pinned ? 'public, max-age=31536000, immutable' : o.cache || (/\.(jpe?g|png|svg|webp|ico|mp4)$/i.test(f) ? 'public, max-age=3600' : 'no-cache');
  if (ZTEXT.test(f) && size < 8e6 && !req.headers.range) {
    const e = fileEntry(f), h = { 'content-type': type, 'cache-control': cache, etag: e.etag, vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, h); return res.end(); }
    const enc = size > 1024 ? encOf(req) : null, body = enc ? (e[enc] ||= zip(e.raw, enc, 9)) : e.raw;
    res.writeHead(200, { ...h, ...(enc ? { 'content-encoding': enc } : {}), 'content-length': body.length }); return res.end(req.method === 'HEAD' ? undefined : body);
  }
  const etag = `W/"${size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag && !req.headers.range) { res.writeHead(304, { etag, 'cache-control': cache }); return res.end(); }
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const a = m[1] ? +m[1] : size - +m[2], b = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${a}-${b}/${size}`, 'accept-ranges': 'bytes', 'content-length': b - a + 1, 'cache-control': cache, etag });
    return fs.createReadStream(f, { start: a, end: b }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': cache, etag });
  fs.createReadStream(f).pipe(res);
};
/* every other answer (JSON, the brand's seed and facts scripts, the page) goes out compressed when it is text and over 1 KB:
   the feed is ~400 KB of JSON. Streams (server-sent events, the jam's reply) write before they end and pass through as they are */
const ZTYPE = /^(application\/(json|javascript)|text\/(html|javascript|plain|css))/;
const zipRes = (req, res) => {
  const enc = encOf(req); if (!enc) return;
  const wh = res.writeHead, wr = res.write, en = res.end; let held = null;
  const flush = () => { if (held) { const h = held; held = null; wh.apply(res, h); } };
  res.writeHead = function (...a) { held = a; return res; };
  res.write = function (...a) { flush(); return wr.apply(res, a); };
  res.end = function (body, ...rest) {
    if (held && (typeof body === 'string' || Buffer.isBuffer(body))) {
      const [code] = held, hd = held.find((x, i) => i > 0 && x && typeof x === 'object') || {}, get = (k) => Object.entries(hd).find(([x]) => x.toLowerCase() === k)?.[1] ?? res.getHeader(k);
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, typeof rest[0] === 'string' ? rest[0] : 'utf8');
      if (code === 200 && buf.length > 1024 && !get('content-encoding') && ZTYPE.test(String(get('content-type') || ''))) {
        const z = zip(buf, enc), out = Object.fromEntries(Object.entries(hd).filter(([x]) => x.toLowerCase() !== 'content-length'));
        held = null; res.removeHeader('content-length'); wh.call(res, code, { ...out, 'content-encoding': enc, vary: 'Accept-Encoding', 'content-length': z.length });
        return en.call(res, z, ...rest.filter((x) => typeof x === 'function'));
      }
    }
    flush(); return en.call(res, body, ...rest);
  };
};
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((res) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch { res({}); } }); });
// a page-relative image path → the file: public/… or a brand pack asset (b/<slug>/a/<file>)
const BRANDS_DIR = path.join(ROOT, '.brands');
const photoFile = (rel) => { const r = String(rel || '').replace(/^\/+/, '').replace(/[?#].*$/, ''); const m = /^b\/([a-z0-9-]+)\/a\/([\w.-]+)$/.exec(r); return m ? path.join(BRANDS_DIR, m[1], 'assets', m[2]) : path.join(PUB, r); };
const isFile = (f) => { try { return !!f && fs.statSync(f).isFile(); } catch { return false; } };
/* a local path this instance lacks (photoFile of a brand asset, a research photo or a generated file that lives only in the
   bucket, or this instance's own empty disk after a restart): the bucket's copy, or null. The image guard calls it */
const resolveLocal = async (f) => { if (isFile(f)) return f; const n = path.normalize(String(f || ''));
  const a = n.startsWith(BRANDS_DIR + path.sep) ? /^([a-z0-9-]+)[\\/]assets[\\/]([\w.-]+)$/.exec(path.relative(BRANDS_DIR, n)) : null; if (a) return packs.assetFile(a[1], a[2]).catch(() => null);
  if (n.startsWith(path.join(PUB, 'research') + path.sep)) return researchFile(path.basename(n));
  if (n.startsWith(GEN + path.sep)) return genFile(path.basename(n));
  return null; };
// the same, but a brand asset missing on this instance is fetched from the bucket first (images need the real product)
/* a store photo by its address (a product the team picked in the studio): fetched once into the temp folder */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const urlPhoto = async (u) => { const f = path.join(os.tmpdir(), 'feed-ph-' + crypto.createHash('sha1').update(u).digest('hex').slice(0, 16) + (String(u).match(/\.(png|webp|jpe?g)(\?|$)/i)?.[0].replace(/\?$/, '') || '.jpg'));
  if (isFile(f)) return f;
  for (let i = 0; i < 2; i++) { /* a store CDN that blinks once is asked again; a browser's user agent, since some CDNs refuse bare fetches */
    try { const r = await safeFetch(u, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': UA, accept: 'image/*,*/*' } }); if (!r.ok) { if (r.status < 500 && r.status !== 429) return null; continue; }
      const b = Buffer.from(await r.arrayBuffer()); if (!b.length || b.length > 15e6 || /^\s*</.test(b.slice(0, 64).toString())) return null; fs.writeFileSync(f, b); return f; } catch {} }
  return null; };
/* any photo reference → a local file, or null (never a directory or a missing path): a store URL, a brand asset, a generated
   file, a research photo (all fetched from the bucket when this instance lacks them), or a public file */
const photoAsync = async (rel) => { const r = String(rel || '').trim(); if (!r) return null; if (/^https?:\/\//.test(r)) return urlPhoto(r.replace(/^http:/, 'https:'));
  const m = /^\/?b\/([a-z0-9-]+)\/a\/([\w.-]+)$/.exec(r); if (m) return packs.assetFile(m[1], m[2]).catch(() => null);
  const g = /^\/?gen\/([\w.-]+)$/.exec(r); if (g) return genFile(g[1]);
  const rs = /^\/?research\/([\w.-]+)$/.exec(r); if (rs) return researchFile(rs[1]);
  const f = photoFile(r); return isFile(f) ? f : null; };

const routes = {
  'GET /api/research': async () => { const r = B().research; return { ...r.get(), running: r.running(), spent: r.spent() }; },
  'POST /api/research/refresh': async (b, req) => { if (!(await genOk(req, B().slug))) return demoErr(); const ok = ['ads', 'trends', 'news', 'howto']; const which = (b.sources || ok).filter((k) => ok.includes(k)); B().research.refresh(which); return { started: which }; },
  'GET /api/config': async () => ({ ai: MOCK ? 'mock' : 'live', provider: PROVIDER, paused: !MOCK && aiPaused(), image: !!(GPROJECT || OPENAI_KEY), caps: CAPS, used }),
  'POST /api/config': async (b, req) => { if (!auth.isAdmin(auth.user(req))) return { error: 'admins only', ai: MOCK ? 'mock' : 'live' }; if (b.ai === 'mock') MOCK = true; if (b.ai === 'live' && anthropic) MOCK = false; return { ai: MOCK ? 'mock' : 'live' }; }
};

// brand packs: every brand the build has read (brand-pack.js, build.js), and the Brew default context
const BUCKET = process.env.RESEARCH_BUCKET || 'brew-prototype';
// one treg client for everything (24-hour cache in the bucket); research uses it too, so it exists before any brand loads
const treg = createTreg({ client: 'shopos-feed', cache: process.env.K_SERVICE && !MOCK ? gcsCache({ bucket: BUCKET, gToken }) : null });
if (process.env.K_SERVICE && !MOCK) setApifyCache(gcsCache({ bucket: BUCKET, gToken, prefix: '_cache/apify/' })); // Apify runs: same rules as treg
let feedSvc = null; // made below, once the brand plumbing exists
const retire = createRetire({ bucket: BUCKET, gToken, log: console });
const retireInit = retire.init().catch((e) => console.warn('[retire] init', e.message)); // first, before any brand loads: the stores wait on it
const packs = createPacks({ ROOT, PUB, bucket: BUCKET, gToken });
/* the day's usage survives a restart or a deploy (it reset on every one): AI calls by kind and treg dollars, kept in the bucket */
var USAGE = 'usage-day.json', usageT = null; // var: spend() is defined earlier and may run before this line in tests
function saveUsage() { clearTimeout(usageT); usageT = setTimeout(() => packs.put('_brew', USAGE, { ...used, treg: { day: treg.meter.day, usd: treg.meter.dayUsd } }).catch((e) => console.warn('[usage] save', e.message)), 3000); } // hoisted: spend() may call it
packs.getJSON('_brew', USAGE, null).then((j) => { if (!j) return; const d = new Date().toDateString();
  if (j.day === d) for (const k of ['text', 'image', 'video', 'voice']) used[k] = Math.max(used[k], +j[k] || 0);
  if (j.treg?.day === d && j.treg.day === treg.meter.day) treg.meter.dayUsd = Math.max(treg.meter.dayUsd, +j.treg.usd || 0); }).catch(() => {});
treg.onCharge(() => saveUsage());
configureGen({ dir: GEN, researchDir: path.join(PUB, 'research'), bucket: BUCKET, gToken, log: console });
const store = createStore({ dir: path.join(ROOT, '.tenants'), bucket: BUCKET, gToken });
// each brand gets its own research (story rings) and live watchers. A generated brand gets them once its read is in
// (they need its rivals, search terms, questions and country); until then a quiet stand-in answers.
const STUB = { get: () => ({}), running: () => [], spent: () => ({}), onRefresh: () => {}, refresh: () => [], mediaFile: async () => null, start: async () => {}, ready: async () => {} };
const INST = new Map(); // slug → { key, research, live }
const attach = (p) => {
  if (!p) return p;
  if (p.kind === 'generated') setTimeout(() => notesSvc?.fill(p).catch((e) => console.warn('[notes]', p.slug, e.message)), 5000); /* margin notes for cards that never had one */
  if (p.kind === 'generated') setTimeout(() => valueSvc?.fill(p).catch((e) => console.warn('[move-value]', p.slug, e.message)), 8000); /* grades for moves new or rewritten since the last grading */
  const c = p.config || {}, key = JSON.stringify([c.rivals, c.terms, c.questions, c.country, c.catalogUrl, p.name]);
  const read = p.kind !== 'default' && (c.questions?.length || c.rivals?.length); // the default context runs no watchers
  let x = INST.get(p.slug);
  if (read && (!x || x.key !== key)) {
    if (x) { try { x.live?.stop?.(); x.research?.stop?.(); } catch {} } /* the replaced watchers stop: no duplicate timers or catalog signals */
    const params = (m, max) => ({ ...claudeParams(m, max), system: p.system });
    x = { key, research: createResearch({ ROOT, PUB, anthropic, claudeParams: params, textOf, geminiImage, gToken, clean, factBrief: () => (packs.peek(p.slug) || p).factBrief, brand: p, photoFile, tregClient: treg }),
      live: createLiveWatch({ ROOT, anthropic, claudeParams: params, textOf, gToken, brand: p, tregClient: treg }) };
    INST.set(p.slug, x);
    x.research.start().catch((e) => console.error('[research] start', p.slug, e.message)); x.live.start().catch((e) => console.error('[live] start', p.slug, e.message));
    p.research = x.research; p.live = x.live; feedSvc?.wire(p);
    // the catalog watch saw something new: the builder decides if the moves need a fresh look
    x.live.onRefresh((done) => { if (!done.includes('catalog')) return; try { const c = x.live.get().catalog; builder.signal(p.slug, (c?.events || []).filter((e) => e.at === c.fetchedAt)).catch(() => {}); } catch {} });
  }
  p.research = x?.research || STUB; p.live = x?.live || STUB;
  return p;
};
const loadBrand = async (slug, o) => blocked(slug) ? null : attach(await packs.load(slug, o));
const brandPacks = { load: loadBrand, peek: (slug) => packs.peek(slug) };
setDefaultBrand(await loadBrand(DEFAULT));
const ai = createAI({ apiKey: ANTHROPIC_KEY, mock: process.env.AI_MOCK === '1' || (PROVIDER === 'anthropic' && !ANTHROPIC_KEY) });
/* margin notes (notes.js): one Sonnet call per brand for cards never considered, about $0.05; on Cloud Run, or locally with NOTES_BG=1 */
/* move grades for the ranker (value.js): one Sonnet call per 20 moves, once per move version, about $0.10 a brand */
const valueSvc = createValue({ ai, packs, log: console, allow: () => !MOCK && (!!process.env.K_SERVICE || process.env.NOTES_BG === '1') });
const notesSvc = createNotes({ ai, packs, log: console, allow: () => !MOCK && (!!process.env.K_SERVICE || process.env.NOTES_BG === '1') });
spendLedger(treg, packs, { log: console });
const calendar = createCalendar({ packs, ai, log: console });
const builder = createBuilder({ ROOT, packs, ai, treg, image: geminiImage, log: console, signGate: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.FEED_SIGNIN !== '0' && process.env.BUILD_SIGNIN !== '0'),
  // a pack changed on disk (new seed, facts, moves): reload it, keep its research/live instances
  onPack: async (slug) => { packs.drop(slug); attach(await packs.load(slug)); },
  onCards: (slug, cards, o) => { if (o?.private) connectors?.drop(slug); feedSvc?.addCards(slug, cards, o); } });
/* ---------- brand memory (brand-memory.js): shared per-brand memory, read into every jam prompt. BRAND_MEMORY=0 turns it off ---------- */
const MEMORY_ON = () => process.env.BRAND_MEMORY !== '0';
const memory = createBrandMemory({ ai, packs, embed: vertexEmbedder({ gToken, project: GPROJECT }), allow: () => !MOCK, log: console });
if (MEMORY_ON()) setMemoryHooks(memoryHooks(memory, { slugOf: (t) => t?.brandId || B()?.slug || null, nameOf: (slug) => packs.peek(slug)?.name || null, canWrite: async (slug, t) => { const m = await auth.getMembers(slug).catch(() => null); if (!m?.owner) return true; return !!(t?.memberEmail && await auth.isMember(slug, { email: t.memberEmail }).catch(() => false)); } }));
/* ---------- end brand memory ---------- */
/* ---------- social: listening and the ideas stream run in the background (social-feed.js). Caps: SOCIAL_DAY_CAP_USD (default $2 a brand a day),
   LISTEN_OFF / IDEAS_OFF kill switches, paid sources on (LISTEN_PAID=0 turns them off); off under AI_MOCK and on local servers (RESEARCH_OFF / LIVE_OFF) unless SOCIAL_BG=1 ---------- */
const social = createSocialScheduler({ packs, ai, treg, memory: MEMORY_ON() ? memory : null, log: console,
  onFresh: async (slug) => { forgetSocial(slug); packs.drop(slug); attach(await packs.load(slug)); feedSvc?.syncSocial(slug); } });
social.start();
/* ---------- evidence in the background: market numbers once a day (only the signals that are due run), and a weekly read of the top
   videos people talk about. Same switches as social (SOCIAL_BG / RESEARCH_OFF / LIVE_OFF, off under AI_MOCK); EVIDENCE_OFF=1 stops it ---------- */
const EV = { busy: false, last: {} }, evOff = () => process.env.EVIDENCE_OFF === '1' || process.env.AI_MOCK === '1' || process.env.SOCIAL_BG === '0' || (process.env.SOCIAL_BG !== '1' && (!!process.env.RESEARCH_OFF || !!process.env.LIVE_OFF));
const videoRead = createVideoRead({ packs, treg, ai, log: console, gToken });
async function evidenceTick() {
  if (EV.busy || evOff()) return; EV.busy = true;
  try { const brands = (await builder.list()).filter((b) => b.state === 'Ready' || /moves/.test(b.state || '')), day = new Date().toISOString().slice(0, 10); let n = 0;
    for (const b of brands) { if (n >= 2) break; const st = (await packs.getJSON(b.slug, 'pulse/state.json', null).catch(() => null)) || {};
      if (EV.last[b.slug] === day || String(st.at || '').slice(0, 10) === day) continue; EV.last[b.slug] = day; n++;
      try { const r = await createPulse({ slug: b.slug, packs, treg, ai, log: console }).run(); console.log('[pulse]', b.slug, r.lines?.length || 0, 'lines', `$${(r.usd || 0).toFixed(3)}`);
        /* a rival moved (a price change or a launch on its store): the move it hits hardest is rewritten (at most one a day) */
        const ev = (r.lines || []).filter((l) => /^catalog\.(price|new)\./.test(l.key) && +l.value > 0).map((l) => ({ kind: l.key.startsWith('catalog.price.') ? 'rival-price' : 'rival-launch', subject: l.subject, items: l.items }));
        if (ev.length) builder.signal(b.slug, ev).catch((e) => console.warn('[pulse] signal', e.message)); } catch (e) { console.warn('[pulse]', b.slug, e.message); }
      // once a week: read the most-talked-about videos heard for the brand (hooks for the jam and the creative moves)
      const vs = await packs.getJSON(b.slug, 'video/state.json', null).catch(() => null);
      if (!vs || Date.now() - (vs.at || 0) > 7 * 864e5) { try { const it = (await packs.getJSON(b.slug, 'listen/items.json', null))?.items || [];
        const vids = it.filter((x) => /tiktok|instagram|youtube/.test(x.platform) && x.kind === 'post' && x.link).sort((a, c) => (c.likes || 0) - (a.likes || 0));
        await videoRead.readTop({ slug: b.slug, items: vids, n: 3, why: 'top talked-about videos' }); await packs.put(b.slug, 'video/state.json', { at: Date.now() }); } catch (e) { console.warn('[video]', b.slug, e.message); } } }
    // once a week, for every brand at once: estimated festival and sale dates checked against what organisers have announced
    const cs = await packs.getJSON('_brew', 'calendar/confirm-state.json', null).catch(() => null);
    if (!cs || Date.now() - (cs.at || 0) > 7 * 864e5) { const r = await calendar.confirmDates({ treg }).catch((e) => ({ error: e.message })); await packs.put('_brew', 'calendar/confirm-state.json', { at: Date.now(), last: r }); console.log('[calendar] confirm', JSON.stringify(r).slice(0, 200)); }
  } finally { EV.busy = false; } }
setInterval(() => evidenceTick().catch((e) => console.warn('[evidence]', e.message)), 30 * 60e3).unref?.(); setTimeout(() => evidenceTick().catch(() => {}), 5 * 60e3).unref?.();
/* ---------- moves on a cadence (moves-cadence.js): audit, listening and automation moves for every built brand, weekly. Cap MOVES_WEEK_CAP_USD (default $3 a brand a week),
   kill switch MOVES_REFRESH_OFF=1; off under AI_MOCK and on local servers unless MOVES_BG=1. Manual: POST /api/brands/:slug/moves/refresh (team-only on claimed brands) ---------- */
const movesCadence = createMovesScheduler({ packs, ai, memory: MEMORY_ON() ? memory : null, cardsGen: createCardsGen, log: console,
  onPack: async (slug) => { packs.drop(slug); attach(await packs.load(slug)); }, onCards: (slug, cards) => feedSvc?.addCards(slug, cards), dropCards: (slug, ids) => feedSvc?.dropCards(slug, ids), pdfFor: null /* PDFs are made on download (builder.pdfOn) */ });
movesCadence.start();
/* ---------- brand learnings (brand-learnings.js): the team pastes a call transcript, notes or emails into a jam; Brew learns the essence,
   goals, beliefs and facts (each with its source), updates the brief, memory and system prompt, flags and rewrites the moves it changes
   (build.js rewrite caps, LEARN_REWRITE_MAX, default 4) and writes new ones (the cadence "learn" family, under MOVES_WEEK_CAP_USD).
   About $0.03 per 14k characters read; LEARN_DAY_MAX sources a brand a day (default 12) ---------- */
const learnings = createLearnings({ ai, packs, memory: MEMORY_ON() ? memory : null, builder, cadence: movesCadence, log: console, onPack: async (slug) => { packs.drop(slug); attach(await packs.load(slug)); } });
/* ---------- the fact sheet (facts-desk.js): the team corrects facts any time; a free daily price and stock check against the store's
   products.json (brands opened in the last 7 days); connected accounts become the source of truth (members only).
   Kill switch FACTS_DAILY_OFF=1; off under AI_MOCK and on local servers unless FACTS_BG=1 ---------- */
const factsDesk = createFactsDesk({ packs, builder, ai, log: console, onPack: async (slug) => { packs.drop(slug); attach(await packs.load(slug)); } });
builder.setHooks({ connected: (slug, tool) => factsDesk.connected(slug, tool) });
factsDesk.start();
/* ---------- first drafts on the cards (drafts-bg.js): brands opened in the last 3 days, every card that names a format, in that format
   (video, carousel, stories, collection, image, email / WhatsApp / page mocks). Cap DRAFTS_DAY_CAP_USD (default $4 a brand a day) at real cost,
   videos also under DAILY_VIDEO_CAP; kill switch DRAFTS_BG_OFF=1; off under AI_MOCK and on local servers unless DRAFTS_BG=1 ---------- */
/* ---------- stories keep moving for brands in use: a brand opened in the last 3 days gets its research (story rings) running even
   when nobody has opened it since the last restart. Off with STORIES_BG=0, under AI_MOCK and on local servers ---------- */
const storiesWarm = async () => { if (process.env.STORIES_BG === '0' || process.env.AI_MOCK === '1' || !process.env.K_SERVICE) return;
  for (const b of await builder.list().catch(() => [])) { if (!(b.state === 'Ready' || /moves/.test(b.state || '')) || INST.has(b.slug)) continue;
    const lo = (await social.stateOf(b.slug).catch(() => null))?.lastOpen || 0; if (Date.now() - lo > 3 * 864e5) continue;
    try { attach(await packs.load(b.slug)); console.log('[stories] warm', b.slug); } catch (e) { console.warn('[stories] warm', b.slug, e.message); } } };
setTimeout(() => storiesWarm().catch(() => {}), 90e3).unref?.(); setInterval(() => storiesWarm().catch(() => {}), 60 * 60e3).unref?.();
const draftsBg = createDraftsBg({ packs, ai, geminiImage, saveGen, genFile, photoAsync, treg, launchBrowser, zipBuffer, spend, memory: MEMORY_ON() ? memory : null, loadPack: (slug) => packs.load(slug), log: console,
  lastOpenOf: async (slug) => (await social.stateOf(slug))?.lastOpen || 0, onDrafts: async (slug) => { packs.drop(slug); attach(await packs.load(slug)); } });
draftsBg.start();
/* first drafts are made by whichever instance's background job ran: every instance re-reads them from the bucket every 3 minutes,
   so a refresh that lands on another instance shows the same drafts (pack files are otherwise served from this instance's disk first) */
if (packs.remote) setInterval(() => packs.refreshDrafts().catch((e) => console.warn('[drafts] refresh', e.message)), 3 * 60e3).unref?.();
// Google sign-in, claiming a brand, its team (auth.js); real connected accounts (connectors/)
const hostOf = async (slug) => { if (!slug || blocked(slug)) return null; const s0 = await packs.getJSON(slug, 'status.json', null); return s0?.host || null; };
/* seat key → title for invite emails and the approve page (the brand's own roles; every generated brand shares the template's) */
const seatNames = async (slug) => { const p = packs.peek(slug) || await packs.load(slug).catch(() => null); return Object.fromEntries(Object.entries(p?.seed?.roles || {}).map(([k, r]) => [k, r.title || r.name || k])); };
const auth = createAuth({ packs, hostOf, seatNames, onTeamChange: () => MEMO.clear(), log: console });
/* Brew's emails about jams to the brand's team: tagged, asked, assigned, needs your OK right away; replies batched (jam-mail.js) */
const jamMail = createJamMail({ mail: (...a) => auth.mail(...a), packs, sign: auth.sign, verify: auth.verify, brandName: (slug) => packs.peek(slug)?.seed?.brand?.name || slug, watching: (wid, email) => !!feedSvc?.jams?.watching?.(wid, email), log: console });
/* Demo Mode: a visitor with no Google sign-in is the owner of their own demo session (demo-mode.js virtualFile) */
if (DEMO) { const realUser = auth.user; auth.user = (req) => realUser(req) || (demoSid() ? { email: demoEmail(), name: 'You', demo: true } : null); }
const memoryRoutes = createMemoryRoutes({ memory, viewerOf: (req, slug) => viewerOf(req, slug), readBody, send, enabled: MEMORY_ON, exists: async (slug) => !blocked(slug) && (!!(await packs.getJSON(slug, 'status.json', null))) }); // brand memory
const movesRoutes = movesCadence.routes({ viewerOf: (req, slug) => viewerOf(req, slug), readBody, send, exists: async (slug) => !blocked(slug) && slug !== DEFAULT && !!(await packs.getJSON(slug, 'status.json', null)) });
// is this person on the brand's team, and is the brand claimed (cached a minute: every feed call asks)
const MEMO = new Map();
const viewerOf = async (req, slug) => { if (process.env.DEV_MEMBER === '1' && !process.env.K_SERVICE && !auth.user(req)?.sub?.startsWith?.('dev')) return { member: true, claimed: true, gen: true, email: process.env.DEV_EMAIL || 'dev@local', name: process.env.DEV_NAME || 'Dev', seats: process.env.DEV_SEATS != null ? process.env.DEV_SEATS.split(',').filter(Boolean) : null }; // local testing of team-only paths; never on Cloud Run
  const me = auth.user(req), k = `${slug}|${me?.email || ''}`, c = MEMO.get(k); if (c && Date.now() - c.at < (c.v.gen ? 60e3 : 10e3)) return c.v; // a demo verdict is kept only briefly: an invite or claim on another instance shows up within seconds
  /* gen: may make fresh work here (the team, SquareUp, an official email on an unclaimed brand); everyone else sees the demo.
     A server with no sign-in (local) has nobody to tell apart, so it stays open */
  const a = await auth.accessOf(slug, me), member = !!a.role;
  const dev = !process.env.K_SERVICE && String(me?.sub || '').startsWith('dev'); /* a local dev sign-in (/auth/dev) is judged like a real one */
  const v = { member, claimed: a.claimed, eligible: a.eligible, gen: a.gen || (!auth.signinOn() && !dev), host: a.host || null, email: me?.email || null, name: me?.name || null, pic: me?.pic || null, seats: member ? a.seats : null }; MEMO.set(k, { at: Date.now(), v }); if (MEMO.size > 5000) MEMO.clear(); return v; };
/* fresh work (AI text, images, video, voice, rewrites) for this brand: the gate every generation route asks. With no brand
   open (the Brew default context), only SquareUp's people make new work */
const genOk = async (req, slug) => { const dev = !process.env.K_SERVICE && String(auth.user(req)?.sub || '').startsWith('dev');
  if (process.env.DEMO_MODE === '1' || ((!auth.signinOn() || (process.env.DEV_MEMBER === '1' && !process.env.K_SERVICE)) && !dev)) return true;
  if (!slug || slug === DEFAULT) return auth.isAdmin(auth.user(req)); return !!(await viewerOf(req, slug)).gen; };
const demoErr = (host) => ({ error: `Demo mode: sign in with your work email${host ? ` at ${host}` : ''} to make this.`, demo: true, host: host || null });
let connectors = null;
/* DUMMY: connected accounts are simulated (connectors/sim.js, from the brand's real read). The real build needs OAuth, a token vault and
   per-platform syncs (see DUMMY.md). Connecting only ever touches the simulated account. */
connectors = createConnectors({ packs, auth, builder, log: console, onLive: (slug) => { MEMO.clear(); feedSvc?.refreshLive(slug).catch(() => {}); } });
/* a shared jam link: anyone can look; signing in makes a person a guest of that one jam (feed-service guestOk), never a
   member of the brand's team. Team access comes only from an owner's invite or the brand's work email (auth.js) */
feedSvc = createFeedService({ /* tagging an email in a jam invites them to the team, with the tagger's own views (any teammate may invite to their views) */
  inviteTo: async (slug, by, email) => { const role = await auth.roleOf(slug, by); if (!role) return { error: 'Only the team invites people.' }; const seats = role === 'owner' || role === 'admin' ? 'all' : (await auth.seatsOf(slug, by)) ?? 'all';
    return auth.invite(slug, by, email, seats, process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', true); }, liveTeamOnly: () => auth.signinOn() && process.env.DEMO_MODE !== '1', clientIp, jamMail, isStaff: (email) => auth.isAdmin({ email }), teamOf: (slug) => auth.getMembers(slug), onOpen: (slug) => { social.opened(slug); draftsBg.opened(slug); builder.heal?.(slug).then((ch) => { if (ch?.length) { packs.drop(slug); loadBrand(slug).catch(() => {}); } }).catch(() => {}); }, PUB, claudeJSON,  globalPacks: packs, claudeTool, cardBrief, mockVariants, geminiImage: imageGen, treg, launchBrowser, zipBuffer, photoAsync, isMock: () => MOCK, spend, BANNED, clean, store, packs: brandPacks, builder, photoFile, learnings,
  /* Demo Mode: a tour session reads the store live while the visitor watches (demo-routes.js session flow) */
  liveReadFor: DEMO ? async (slug) => (await packs.getJSON(slug, 'private/demo/session.json', null))?.flow === 'onboarding' : null,
  viewerOf, genOk, liveFor: (slug, member) => connectors.forViewer(slug, member),
  /* membership checked from the signed-in user on every request and on the background clock (feed-service.js REQ / bgTeam) */
  isMemberEmail: (slug, email) => auth.isMember(slug, { email: String(email || '').toLowerCase() }), roleOf: (slug, email) => auth.roleOf(slug, { email: String(email || '').toLowerCase() }) });
feedSvc.wire(B());
retireInit.finally(() => { if (!process.env.BUILD_RESUME_OFF) builder.resumeAll().catch((e) => console.error('[build] resumeAll', e.message)); }); // resume off for a local server reading the live bucket

/* ---------- brand routes: start a read, its status and live events, "check what we read", moves and PDFs ---------- */
/* On live, a brand's moves, PDFs, read, facts, Heard and stories are for its team (members, SquareUp, or the brand's own work
   email before it is claimed); the demo site stays open to anyone (Param, 2026-10-15). Status and progress stay public, so
   someone signing in mid-read still sees where it is */
const teamRead = async (req, slug) => { if (process.env.DEMO_MODE === '1' || !auth.signinOn() || !slug || slug === DEFAULT) return true; const v = await viewerOf(req, slug); return !!(v.member || v.gen); };
const TEAM_READ = /^\/api\/brands\/([a-z0-9-]+)\/(heard(?:\/(?:items|history|asked))?|moves(?:\/\d+|\/cadence)?|facts|findings|check|build|updates|summary|events)$/;
const teamGate = async (req, res, u) => {
  if (req.method !== 'GET') return false;
  const m = u.pathname.match(TEAM_READ), slug = m ? m[1] : u.pathname === '/api/research' ? req.headers['x-brand'] : null;
  if (!slug || await teamRead(req, String(slug))) return false;
  const me = auth.user(req); send(res, me ? 403 : 401, { error: me ? 'This brand’s moves and read are for its team. Ask them to invite you.' : 'Sign in to see this brand.', team: true, signin: !me }); return true; };
const brandRoutes = async (req, res, u) => {
  const ip = clientIp(req); /* the entry Google's front end appended, not one the client wrote (build.js clientIp) */
  if (req.method === 'POST' && u.pathname === '/api/brands') { const b = await readBody(req), me = auth.user(req);
    /* a read costs about $6 (crawl, Ad Library, AI answers, rivals): it starts only for someone signed in (2026-10-15), who then
       gets BUILD_PER_USER_DAY new brands a day. The page sends them to Google and starts the read when they come back (?build=).
       The demo site answers this route itself (demo-routes.js) */
    if (!me && auth.signinOn() && process.env.BUILD_SIGNIN !== '0') return send(res, 200, { error: b.fresh ? 'Sign in with Google to read this brand again.' : 'Sign in with Google to read your store.', signin: true }), true;
    return send(res, 200, await builder.start(b.url, { ip, user: me, fresh: !!b.fresh && !!me && (await viewerOf(req, slugOf(b.url))).gen })), true; }
  if (req.method === 'GET' && u.pathname === '/api/brands') { const all = await builder.list(), me = auth.user(req); if (process.env.DEMO_MODE === '1' || !auth.signinOn() || auth.isAdmin(me)) return send(res, 200, { brands: all }), true;
    const mine = []; if (me) for (const b of all) if ((await viewerOf(req, b.slug).catch(() => ({}))).member) mine.push(b); return send(res, 200, { brands: mine }), true; } // the brands this person is on: never other clients or prospects mid-read
  // the landing's demo brands: the ones the demo site has fully ready; a tap opens a fresh tour of that brand there
  if (req.method === 'GET' && u.pathname === '/api/demo-brands') return send(res, 200, { brands: await demoBrands() }), true;
  // What Brew learned → What your team told Brew: the goals, beliefs and facts read from the calls, notes and emails the team added
  const tm = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/told$/);
  if (tm && req.method === 'GET') { const slug = tm[1]; if (blocked(slug)) return send(res, 404, { error: 'unknown brand' }), true;
    /* what the team told Brew (pasted call notes, emails): the brand's team only */
    if (auth.signinOn() && process.env.DEMO_MODE !== '1' && !(await viewerOf(req, slug)).member) return send(res, 200, { told: null, team: true }), true;
    const L = await packs.getJSON(slug, 'learned.json', null).catch(() => null);
    return send(res, 200, { told: L ? { ...briefView(L), sources: (L.sources || []).map(({ label, at, kind }) => ({ label, at, kind })) } : null }), true; }
  // What Brew learned → Heard: what listening counted and quoted, for any brand that has it (empty for the rest)
  const hm = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/heard$/);
  if (hm && req.method === 'GET') { const slug = hm[1]; if (blocked(slug)) return send(res, 404, { error: 'unknown brand' }), true;
    const g = (n) => packs.getJSON(slug, n, null).catch(() => null);
    const [th, tr, cm, st, it] = await Promise.all([g('listen/themes.json'), g('listen/threads.json'), g('listen/communities.json'), g('listen/status.json'), g('listen/items.json')]);
    const v = heardView({ themes: th?.themes || [], total: th?.total || 0, threads: tr?.threads || [], communities: cm?.communities || [], status: st, items: it?.items || [] }, { name: packs.peek(slug)?.name || (await packs.getJSON(slug, 'status.json', {}))?.name || slug });
    const bg = await social.due(slug).catch(() => null), ss = await social.stateOf(slug).catch(() => ({}));
    return send(res, 200, { heard: v, schedule: { lastListen: ss.lastListen || null, lastIdeas: ss.lastIdeas || null, spentToday: ss.spend || null, due: bg } }), true; }
  // What we heard: every quote (filter by source, mode, theme, intent, words; paged), the asked threads, the daily history
  const hx = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/heard\/(items|asked|history)$/);
  if (hx) { const [, slug, what] = hx; if (blocked(slug)) return send(res, 404, { error: 'unknown brand' }), true;
    const W = createListenWatch({ slug, packs, treg, ai, log: console }), qp = (k) => u.searchParams.get(k) || undefined;
    if (what === 'items' && req.method === 'GET') return send(res, 200, await W.itemsView({ src: qp('src'), mode: qp('mode'), theme: qp('theme'), intent: qp('intent'), q: qp('q'), offset: +qp('offset') || 0, limit: +qp('limit') || 60 })), true;
    if (what === 'history' && req.method === 'GET') return send(res, 200, await W.history({ days: +qp('days') || 90 })), true;
    if (what === 'asked' && req.method === 'POST') { const v = await viewerOf(req, slug); if (!(v.member || v.gen) || (auth.signinOn() && !v.email)) return send(res, 403, { error: 'Only the brand team can add asked threads.', team: true }), true;
      const b = await readBody(req); const r = await W.addAsked({ moveId: b.moveId, url: b.url, platform: b.platform, postedAt: b.postedAt }); forgetSocial(slug); return send(res, r.error ? 400 : 200, r), true; }
    if (what === 'asked' && req.method === 'GET') return send(res, 200, { asked: (await packs.getJSON(slug, 'listen/asked.json', null).catch(() => null)) || [] }), true;
    return send(res, 405, { error: 'method not allowed' }), true; }
  // the brand's own upcoming moments (its markets only), each with its planning point and the seasonal move once written
  const cal = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/calendar$/);
  if (cal && req.method === 'GET') { const slug = cal[1]; if (blocked(slug)) return send(res, 404, { error: 'unknown brand' }), true;
    try { const [evs, mk, planned] = await Promise.all([calendar.upcoming(slug, { days: Math.min(365, +u.searchParams.get('days') || 120) }), calendar.marketsOf(slug), packs.getJSON(slug, 'calendar/planned.json', null).catch(() => null)]);
      const p = packs.peek(slug), mv = Object.values(p?.moveDocs || {}).filter((m) => m?.eventId || m?.meta?.eventId);
      const events = (evs || []).map((e) => ({ id: e.id, name: e.name, date: e.date || e.plan?.peak, end: e.end || e.date, kind: e.kind, estimated: !!e.estimated, confirmedUrl: e.confirmed?.url || null, planAt: e.plan?.plan || null, planned: !!planned?.[e.id], move: (() => { const m = mv.find((x) => (x.eventId || x.meta?.eventId) === e.id); return m ? { n: m.n, title: m.title } : null; })() }));
      return send(res, 200, { markets: Array.isArray(mk) ? mk : mk?.markets || [], events }), true; }
    catch (e) { return send(res, 200, { markets: [], events: [], error: e.message }), true; } }
  // admins: tools treg added this week that Brew doesn't use yet, and this month's treg spend for a brand
  if (req.method === 'GET' && u.pathname === '/api/admin/treg') { if (!auth.isAdmin(auth.user(req))) return send(res, 403, { error: 'admins only' }), true;
    const slug = u.searchParams.get('brand'), month = new Date().toISOString().slice(0, 7);
    const [news, spend] = await Promise.all([watchCatalog(treg).catch((e) => ({ error: e.message })), slug ? packs.getJSON(slug, `spend/${month}.json`, null).catch(() => null) : null]);
    return send(res, 200, { news, spend, meter: { usd: treg.meter.usd, calls: treg.meter.calls, today: treg.meter.dayUsd } }), true; }
  const mm = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/moves\/(\d+)$/);
  if (mm) { const p = await loadBrand(mm[1]), v = await viewerOf(req, mm[1]); const priv = v.member ? (await packs.getJSON(mm[1], 'private/moves.json', {}))[+mm[2]] : null;
    return send(res, 200, priv ? { ...priv, private: true } : p?.moveDocs?.[+mm[2]] || { error: 'not written yet' }), true; }
  /* the fact sheet: anyone may read the public sheet; members also see their connected facts; on a claimed brand only its team edits */
  const fm = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/facts$/);
  if (fm) { const slug = fm[1]; if (blocked(slug) || !(await packs.getJSON(slug, 'status.json', null))) return send(res, 404, { error: 'unknown brand' }), true;
    const fv = await viewerOf(req, slug), canEdit = !!fv.member || (!fv.claimed && !!fv.gen && (!auth.signinOn() || !!fv.email)); // the team, or the brand's own work email before it is claimed
    if (req.method === 'GET') return send(res, 200, await factsDesk.view(slug, { member: fv.member, canEdit })), true;
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true;
    if (!canEdit) return send(res, 403, { error: 'Only this brand’s team can change its facts. Ask them for access.', team: true }), true;
    const b = await readBody(req), r = await factsDesk.edit(slug, b, { by: fv.email || 'the team' });
    if (r?.data) r.data = await factsDesk.view(slug, { member: fv.member, canEdit }); return send(res, r?.error ? 400 : 200, r), true; }
  const m = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/(status|summary|confirm|check|build|retry|pro|events|moves|notify|findings|updates)$/); if (!m) return false;
  const [, slug, what] = m;
  // only the team (or an official email on an unclaimed brand, or SquareUp) changes it: confirm, check, rewrite, retry, auto.
  // Everyone else sees the brand in demo mode
  const v = await viewerOf(req, slug);
  if (!v.gen && req.method === 'POST' && what !== 'notify' && !v.email && auth.signinOn() && process.env.BUILD_SIGNIN !== '0') return send(res, 401, { error: 'Sign in with your work email to continue.', signin: true }), true;
  if (!v.gen && req.method === 'POST' && what !== 'notify') return send(res, 403, { ...demoErr(v.host), error: v.claimed ? 'Demo mode: only this brand’s team changes it. Ask them to invite you.' : `Demo mode: the moves are written once someone signs in with a work email at ${v.host || 'the brand’s domain'}.`, team: true }), true;
  if (what === 'status') { const s = (await builder.status(slug)) || { error: 'unknown brand' };
    /* status stays public (someone signing in mid-read sees where it is), but the move titles, files and spend are the team's */
    if (!(await teamRead(req, slug))) { const { pdfs, zips, statics, usd, proBy, proAt, ...pub } = s; return send(res, 200, pub), true; }
    return send(res, 200, s), true; }
  if (what === 'summary') return send(res, 200, await builder.summary(slug)), true;
  if (what === 'notify' && req.method === 'POST') { const b = await readBody(req), me = auth.user(req);
    /* "email me when the moves are in": a signed-in person adds their own address (the team may add a teammate), so nobody turns Brew into a mailer */
    if (auth.signinOn() && !me) return send(res, 401, { error: 'Sign in to get an email when the moves are in.', signin: true }), true;
    if (me && !v.member && String(b.email || '').trim().toLowerCase() !== String(me.email).toLowerCase()) return send(res, 403, { error: `We can only email you, at ${me.email}.` }), true;
    return send(res, 200, await builder.addEmail(slug, b.email)), true; }
  if (what === 'findings') return send(res, 200, (await packs.getJSON(slug, 'findings.json', null)) || { cards: [] }), true;
  /* confirming what was read starts the brief and the moves: a signed-in person only, who becomes the brand's creator if nobody is yet */
  /* an official email confirming the read of a brand nobody has claimed takes it: confirming is the moment it becomes theirs */
  const signGate = async () => { if (!auth.signinOn() || process.env.BUILD_SIGNIN === '0') return null; const me = auth.user(req); if (!me) return { error: 'Sign in with Google to continue.', signin: true };
    if (v.eligible && !v.member) { await auth.claim(slug, me, 'Confirmed the read'); MEMO.clear(); }
    if (!(await packs.getJSON(slug, 'private/created.json', null))) await packs.put(slug, 'private/created.json', { by: me.email, at: Date.now(), after: 'read' }).catch(() => {}); return null; };
  if (what === 'confirm' && req.method === 'POST') { const g = await signGate(); if (g) return send(res, 401, g), true; const b = await readBody(req); return send(res, 200, await builder.confirm(slug, b.edits || [], b.v2 || null)), true; }
  if (what === 'build') return send(res, 200, await builder.buildInfo(slug)), true;
  if (what === 'updates' && req.method === 'GET') return send(res, 200, await builder.updates(slug, { member: v.member || !v.claimed })), true;
  if (what === 'updates' && req.method === 'POST') { const b = await readBody(req); // check | rewrite { moves } | auto { on }
    const r = b.action === 'check' ? await builder.checkUpdates(slug) : b.action === 'rewrite' ? await builder.rewrite(slug, b.moves || []) : b.action === 'auto' ? await builder.setAuto(slug, b.on) : { error: 'unknown action' };
    return send(res, 200, r), true; }
  if (what === 'retry' && req.method === 'POST') return send(res, 200, await builder.retry(slug)), true;
  if (what === 'pro' && req.method === 'POST') { const me = auth.user(req); return send(res, 200, await builder.goPro(slug, { by: me?.email || v.email || null })), true; } // the paused build carries on to every move
  if (what === 'check' && req.method === 'GET') return send(res, 200, await builder.checkData(slug, { heal: !auth.signinOn() || !!auth.user(req) })), true; // a paid repair of the saved read only for someone signed in
  if (what === 'check' && req.method === 'POST') { const g = await signGate(); if (g) return send(res, 401, g), true; const b = await readBody(req); return send(res, 200, await builder.applyCheck(slug, b)), true; }
  if (what === 'moves') { const p = await loadBrand(slug); const pm = v.member ? await packs.getJSON(slug, 'private/moves.json', {}) : {}, ms = { ...(p?.moveDocs || {}), ...pm };
    const stale = Object.fromEntries(Object.entries((await packs.getJSON(slug, 'updates.json', null))?.stale || {}).filter(([, x]) => v.member || !x.private)), ppdf = v.member ? await packs.getJSON(slug, 'private/pdfs.json', {}) : {};
    return send(res, 200, { moves: Object.values(ms).sort((a, b) => a.n - b.n).map((x) => ({ n: x.n, group: x.group, family: x.family || null, kicker: x.kicker, title: x.title, stat: x.stat, statLabel: x.statLabel, gives: x.gives, live: x.live, verified: !!x.meta?.verified, words: x.meta?.words || null,
      version: x.meta?.version || 1, rewrittenAt: x.meta?.rewrittenAt || null, because: x.meta?.because || null, at: x.meta?.at || null, private: !!pm[x.n], stale: stale[x.n] ? { why: stale[x.n].why, priority: stale[x.n].priority } : null })), pdfs: { ...((await builder.status(slug))?.pdfs || {}), ...ppdf }, zips: (await builder.status(slug))?.zips || [], status: await builder.status(slug) }), true; }
  if (what === 'events') { // the build, live (server-sent events), replayed from the start
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const off = builder.subscribe(slug, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`)); req.on('close', off); return true; }
  return false;
};
// a generated brand's files: its client seed and facts, assets, PDFs
const brandFiles = async (req, res, u) => {
  const m = u.pathname.match(/^\/b\/([a-z0-9-]+)\/(seed\.js|facts\.js|a\/[\w.-]+|statics\/[\w.-]+|pdf\/[^/]+)$/); if (!m) return false;
  const slug = m[1], what = decodeURIComponent(m[2]);
  if (what === 'seed.js' || what === 'facts.js') { let p = await loadBrand(slug, { fresh: true, share: true }); if (!p) return send(res, 404, '/* unknown brand */', 'text/javascript'), true;
    /* outside the team on live: the brand's name, mark and look only (the sign-in page needs them), no cards, moves or facts */
    if (!(await teamRead(req, slug))) p = { ...p, seed: { ...p.seed, posts: [], scrape: [], steps: [] }, rawSeed: p.rawSeed ? { ...p.rawSeed, posts: [], scrape: [], steps: [] } : undefined, fx: {}, facts: {}, moveDocs: {}, labels: {}, pages: {}, pools: {}, statics: [], staticText: {}, notes: {}, learned: null };
    /* the same pack makes the same script: its ETag lets a reload skip the download (still read fresh, so never stale) */
    const body = what === 'seed.js' ? packs.clientSeed(p) : packs.clientFacts(p), etag = `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag, 'cache-control': 'no-cache' }); res.end(); return true; }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', etag }); res.end(body); return true; }
  if (what.startsWith('statics/')) { const b = await packs.get(slug, what); if (!b) return send(res, 404, 'no', 'text/plain'), true; res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=300' }); res.end(b); return true; }
  if (what.startsWith('a/')) { const f = await packs.assetFile(slug, what.slice(2)); if (!f) return send(res, 404, 'no', 'text/plain'), true; return serveFile(req, res, f), true; }
  /* a brand's PDFs (named or drawn on download) are for its team on live */
  if (!(await teamRead(req, slug))) return send(res, auth.user(req) ? 403 : 401, 'These moves are for the brand’s team. Sign in or ask them to invite you.', 'text/plain'), true;
  /* /b/<slug>/pdf/move-<n>.pdf: the move's PDF, drawn on this first download and kept until the move changes */
  const mn = what.slice(4).match(/^move-(\d{1,4})\.pdf$/i);
  if (mn) { const v = await viewerOf(req, slug), pp = v.member ? (await packs.getJSON(slug, 'private/pdfs.json', null))?.[+mn[1]] : null, pb = pp ? await packs.get(slug, 'private/pdf/' + pp) : null;
    let r = pb ? { name: pp, buf: pb } : null; if (!r) try { r = await builder.pdfOn(slug, +mn[1]); } catch (e) { console.warn('[pdf] on demand', slug, mn[1], e.message); return send(res, 503, 'The PDF could not be drawn just now. Try again in a minute.', 'text/plain'), true; }
    if (!r?.buf) return send(res, 404, 'no', 'text/plain'), true;
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': disposition(r.name, u.searchParams.has('dl')), 'cache-control': 'no-cache' }); res.end(r.buf); return true; }
  const name = what.slice(4); if (!/^[^/\\]+\.(pdf|zip)$/i.test(name) || name.includes('..') || name !== path.basename(name)) return send(res, 404, 'no', 'text/plain'), true; /* a file name only: never a path */
  const v = await viewerOf(req, slug), pb = v.member && !name.endsWith('.zip') ? await packs.get(slug, 'private/pdf/' + name) : null, b = pb || await packs.get(slug, 'pdf/' + name); if (!b) return send(res, 404, 'no', 'text/plain'), true;
  res.writeHead(200, { 'content-type': name.endsWith('.zip') ? 'application/zip' : 'application/pdf', 'content-disposition': disposition(name, u.searchParams.has('dl')), 'cache-control': 'no-cache' }); res.end(b); return true;
};
/* a file name in a header: move titles carry ₹, em dashes and accents, which a header cannot; an ASCII name plus the real one (RFC 6266) */
function disposition(name, dl) { const ascii = String(name).normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').replace(/\s+/g, ' ').trim() || 'move.pdf';
  return `${dl ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`; }
// the page: index.html with the brand's seed. "/" is the Brew landing (paste a URL); "/<slug>" is that brand
const DEMO_URL = (process.env.DEMO_URL || 'https://demo.joinsquareup.com').replace(/\/$/, '');
let demoCache = { at: 0, brands: [] };
async function demoBrands() {
  if (Date.now() - demoCache.at < 10 * 60e3) return demoCache.brands;
  try { const r = await fetch(`${DEMO_URL}/api/demo/brands`, { signal: AbortSignal.timeout(6000) }); const j = await r.json();
    const abs = (x) => (!x ? null : /^https?:/.test(x) ? x : `${DEMO_URL}/${String(x).replace(/^\//, '')}`);
    demoCache = { at: Date.now(), brands: (j.brands || []).filter((b) => b.loaded).map((b) => ({ slug: b.slug, name: b.name, host: b.host, category: b.look?.category || null,
      logo: abs(b.look?.logo || b.logo || b.look?.mark), tour: `${DEMO_URL}/tour/${b.slug}?d=new` })) };
  } catch (e) { console.warn('[landing] demo brands', e.message); demoCache.at = Date.now() - 9 * 60e3; } // try again in a minute
  return demoCache.brands;
}
const INDEX = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
// the page names its own scripts and styles by version (app.js?v=<hash>): a repeat visit loads them from the browser's cache
const versioned = (html) => html.replace(/(<(?:script|link)\b[^>]*?\b(?:src|href)=")([\w./-]+\.(?:js|css))(")/g, (m, a, f, z) => { const v = verOf(path.join(PUB, path.normalize(f).replace(/^(\.\.[/\\])+/, ''))); return v ? `${a}${f}?v=${v}${z}` : m; });
const pageFor = async (seg) => {
  const slug = !seg || seg === DEFAULT ? null : seg; // the default context has no page of its own
  let scripts;
  if (!slug) scripts = '<script src="/data/brew.js"></script>';
  else { if (blocked(slug)) return null; const st = await builder.status(slug); if (!st) return null; builder.seen(slug); scripts = `<script src="/b/${slug}/facts.js"></script>\n<script src="/b/${slug}/seed.js"></script>`; }
  if (DEMO) scripts += '\n<script>window.BREW_DEMO = 1;</script>'; // the demo site: demo controls, demo accounts
  const p = slug && await loadBrand(slug);
  const name = p?.name || 'Brew', mark = p ? '/' + String(p.seed.brand.mark).replace(/^\//, '') : '/assets/brew-mark.svg';
  return versioned(INDEX.replace('<base href="/">', '<base href="/">').replace(/<!--BRAND-SCRIPTS-->[\s\S]*?<!--\/BRAND-SCRIPTS-->/, scripts)
    .replace(/<title>[^<]*<\/title>/, `<title>${name === 'Brew' ? 'Brew' : `${name.replace(/</g, '')} · Brew`}</title>`).replace(/rel="icon" href="[^"]*"/, `rel="icon" href="${mark}"`)
    .replace(/name="apple-mobile-web-app-title" content="[^"]*"/, `name="apple-mobile-web-app-title" content="${name.replace(/"/g, '')}"`));
};

/* ---------- talk instead of type: one voice note → text (the mic on every box) ---------- */
// The browser records (webm/ogg/mp4) and posts the raw audio; gpt-4o-transcribe handles Hindi and English mixed.
const TX = new Map();
async function transcribe(req, res) {
  const ip = clientIp(req), hr =Math.floor(Date.now() / 3600e3), k = `${ip}|${hr}`;
  if ((TX.get(k) || 0) >= 80) return send(res, 429, { error: 'Too many voice notes this hour. Type it for now.' }); TX.set(k, (TX.get(k) || 0) + 1); if (TX.size > 5000) TX.clear();
  if (!OPENAI_KEY) return send(res, 200, { error: 'Voice is not set up here. Type it instead.', text: '' });
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 15e6) return send(res, 413, { error: 'That recording is too long. Keep it under 2 minutes.' }); chunks.push(c); }
  const type = String(req.headers['content-type'] || 'audio/webm').split(';')[0], ext = /ogg/.test(type) ? 'ogg' : /mp4|m4a|aac/.test(type) ? 'mp4' : /wav/.test(type) ? 'wav' : 'webm';
  const fd = new FormData(); fd.append('file', new Blob([Buffer.concat(chunks)], { type }), `voice.${ext}`); fd.append('model', 'gpt-4o-transcribe');
  fd.append('prompt', 'A brand team talking about marketing: ads, campaigns, discount codes, WhatsApp, Instagram, Shopify, Meta, launches, budgets in rupees. Hindi and English may be mixed; write Hindi words in Roman script.');
  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${OPENAI_KEY}` }, body: fd, signal: AbortSignal.timeout(60e3) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || `status ${r.status}`);
    return send(res, 200, { text: String(j.text || '').trim() });
  } catch (e) { console.error('[transcribe]', e.message); return send(res, 200, { error: 'Could not hear that. Try again, or type it.', text: '' }); }
}

const demoRoutes = DEMO ? createDemoRoutes({ packs, builder, auth, connectors, readBody, send, loadBrand, social, draftsBg, log: console }) : null;
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  zipRes(req, res);
  retire.claim(); // traffic reaches this revision: it is the live one
  if (DEMO) { const ses = sessionOf(req, u); if (ses.set) res.setHeader('set-cookie', ses.set); return runDemo(ses.sid, () => serve(req, res, u)); }
  return serve(req, res, u);
}).listen(PORT, () => console.log(`Brew Feed on http://localhost:${PORT} · AI ${MOCK ? "mock" : `live (${PROVIDER})`} · env ${fs.existsSync(envFile) ? envFile : 'none'}${DEMO ? ' · DEMO MODE' : ''}`));
/* Cloud Run stops an instance with SIGTERM: the team's jams are written before it goes (jams.js saves every few seconds anyway) */
process.once('SIGTERM', () => { Promise.race([feedSvc?.jams?.flush?.(), new Promise((r) => setTimeout(r, 6000))]).finally(() => process.exit(0)); });
async function serve(req, res, u) {
  try {
    if (demoRoutes && await demoRoutes(req, res, u)) return;
    if (await auth.handle(req, res, u)) return;
    if (await jamMail.handle(req, res, u)) return; // the mute / only-tags links in jam emails
    if (await connectors.handle(req, res, u)) return;
    if (await teamGate(req, res, u)) return; // live: moves, PDFs, read and stories are for the brand's team
    if (await memoryRoutes(req, res, u)) return; // brand memory
    if (await movesRoutes(req, res, u)) return; // moves on a cadence: refresh, cadence state
    if (await brandRoutes(req, res, u)) return;
    if (await brandFiles(req, res, u)) return;
    /* the mic (OpenAI transcription, paid): signed-in people only */
    if (req.method === 'POST' && u.pathname === '/api/transcribe') { if (auth.signinOn() && process.env.DEMO_MODE !== '1' && !auth.user(req)) return send(res, 401, { error: 'Sign in to use the mic.', signin: true }), true; return await transcribe(req, res); }
    if (await feedSvc.handle(req, res, u)) return;
    // everything else under /api runs for the brand the page was opened for (x-brand)
    const br = await loadBrand(String(req.headers['x-brand'] || DEFAULT).replace(/[^a-z0-9-]/g, '')) || B();
    if (req.method === 'POST' && /^\/api\/ai\//.test(u.pathname) && !(await genOk(req, br.slug))) return send(res, 403, demoErr(packs.peek(br.slug)?.seed?.brand?.host || null));
    const fn = routes[`${req.method} ${u.pathname}`];
    if (fn) {
      const b = req.method === 'POST' ? await readBody(req) : {};
      try { return send(res, 200, await runIn(br, () => fn(b, req))); }
      catch (e) { console.error(`[${u.pathname}]`, e.message); return send(res, 200, { error: e.message, fallback: true }); }
    }
    if (u.pathname.startsWith('/research/')) { /* shared by every brand: this instance's disk, then the bucket (never the default brand's research, which has none) */
      const f = await researchFile(path.basename(u.pathname)); if (!f) return send(res, 404, 'no', 'text/plain');
      return serveFile(req, res, f, { immutable: true });
    }
    if (u.pathname.startsWith('/gen/')) {
      const f = await genFile(path.basename(u.pathname)); if (!f) return send(res, 404, 'no', 'text/plain');
      return serveFile(req, res, f, { immutable: true }); /* every generated file gets a new name: its bytes never change */
    }
    let f = path.normalize(path.join(PUB, decodeURIComponent(u.pathname)));
    if (!f.startsWith(PUB)) return send(res, 403, 'no', 'text/plain');
    if (fs.existsSync(f) && fs.statSync(f).isFile() && u.pathname !== '/index.html') return serveFile(req, res, f);
    // a page: / is the landing, /<slug> a brand (an unknown slug falls back to the landing)
    const seg = (u.pathname.match(/^\/([a-z0-9-]+)\/?$/) || [])[1] || '';
    if (/\.[a-z0-9]{2,5}$/i.test(u.pathname)) return send(res, 404, 'no', 'text/plain');
    const html = (await pageFor(seg)) || (await pageFor(''));
    return send(res, 200, html, 'text/html; charset=utf-8');
  } catch (e) { console.error(e); send(res, 500, { error: 'server' }); }
}
