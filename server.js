// Brew prototype server: read → moves → feed → jam → share the brief.
// Serves public/ and a few /api routes: live Claude text, live Gemini (Vertex) images,
// dummy Slack. Keys come from an env file (ENV_FILE, default ../ugc-factory/.env) and are never sent to the page.
import { makePhotoFile } from './safe-path.js';
import { createJamMail } from './jam-mail.js';
import { configureGen, saveGen, genFile, genFlush, researchFile } from './gen-store.js';
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
import { createBrandKit, toMarkdown, toJSON, llmsTxt } from './brand-kit.js'; // the Brand Book shared: /<slug>/brand, .md, .json, llms.txt, brand-kit.zip
import { balanceWarm } from './color-cast.js'; // a picture washed yellow is pulled back toward its product photo (QA 13 Oct)
import { LEGAL, notFoundPage, pageOf } from './legal-pages.js'; // /privacy, /terms and a real 404
import { createAI, aiPaused, billingError, noteBilling, realNewlines } from './ai.js';
import { createAlerts, noteVertex, noteAlert } from './alerts.js'; // ops emails: Vertex billing/quota, the AI pause, treg balance, 5xx rate
import { createBudget } from './budget.js'; // the day's AI budget: a ceiling and a share per brand
import { createTreg, gcsCache } from './treg.js';
import { setApifyCache, createApify, onAnyApifyCharge } from './apify.js';
import { watchView } from './watch-view.js'; // What Brew watches for you: the four blocks
import { PLATFORMS as SHELF_PLATFORMS } from './shelf.js';
const SHELF_KEYS = Object.keys(SHELF_PLATFORMS);
import { chain as mediaChain, openaiImage as openaiImageRaw, makeVideo } from './media.js';
import { createVault } from './vault.js';
import { createSlooshAuth } from './sloosh-auth.js';
import { createSloosh } from './sloosh-mcp.js';
import { createFinals, pick } from './finals.js';
import { buildFinal } from './sloosh-prompt.js'; // the ops page's free check quote
import { createBuilder, blocked, clientIp } from './build.js';
import { createRetire } from './retire.js'; // older revisions stop and exit; brands being reset are hidden
import { createFactsDesk } from './facts-desk.js';
import { createAuth, officialFor } from './auth.js';
import { createConnectors } from './connectors/index.js';
import { createShopifyApp } from './shopify-app.js';
import { createSlackRoutes } from './slack-routes.js';
import { DEMO, demoSid, demoEmail, runDemo, sessionOf, guardFetch } from './demo-mode.js'; // Demo Mode: the demo site (DEMO_MODE=1)
import { createDemoRoutes, simStatus } from './demo-routes.js';
const DEMO_SES = new Map(); /* visitor|slug → the demo tour session, for the feed's view of the build (viewStatus) */
const demoSes = (slug, s) => { DEMO_SES.set(`${demoSid() || ''}|${slug}`, s); if (DEMO_SES.size > 2000) DEMO_SES.delete(DEMO_SES.keys().next().value); }; /* the session as demo-routes last read or wrote it: the feed never counts from the one before */
import { launchBrowser, zipBuffer, withBrowser } from './pdf/render.js';
import { createImageNorm } from './img-norm.js'; // every picture a model sees is PNG, JPEG or WebP
import { thinkModel, prefs } from './model-ctx.js';
import { createBrandMemory, vertexEmbedder, memoryHooks } from './brand-memory.js'; // brand memory
import { createMemoryRoutes } from './memory-routes.js'; // brand memory
import { createMovesScheduler } from './moves-cadence.js'; // audit, listening and automation moves, weekly
import { teamStatic } from './statics.js'; // the team's static ads, members only
import { createIdeas } from './ideas.js'; // OPS_TEAM_PROBE: the team's ideas run
import { realRows, connectedOk } from './connectors/common.js'; // simulated account rows are never evidence
import { createLearnings, briefView } from './brand-learnings.js'; // /update-brand-learnings: a pasted call, notes or emails → brief, memory, moves
import { createDraftsBg } from './drafts-bg.js'; // first drafts on the top cards, in the background
import { createCardsGen } from './cards-gen.js';
import { createClosedGate } from './closed-gate.js'; // a store not launched yet (read from its Shopify admin) is its team's only
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
import { movesEta } from './pack-numbers.js';
import { named as namedStage } from './reader/stages/named.js'; // which brands an AI answer names
import { createAiQuestions, Q_V } from './ai-questions.js'; // the AI answers questions, each earned by real searches or real threads
import { awaitingCheck, createConfirmRemind } from './confirm-remind.js'; // "Check what we read" waits for a person: hold the watchers, remind by email // the time left on a brand's moves, from the pace the build really kept
import { drawableSvg } from './reader/svg-logo.js';
import { markMoveClaims, packSource } from './claims.js'; // the team's private moves read like the shared ones

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
const WRITTEN_HW = new Map(); /* slug → { k: the build (status.createdAt), n: the most moves written it has shown } */
guardFetch(console); // Demo Mode only: no write to a real account, no real message
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODELS = [process.env.FEED_CLAUDE_MODEL || 'claude-sonnet-5-5', 'claude-sonnet-5'];
const GPROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'squareup-492617';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'; /* drafts on the cheap image model; a premium picture is an explicit Make the final (Sloosh, finals.js), never a first draft */
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
let MOCK = process.env.AI_MOCK === '1' || (PROVIDER === 'anthropic' && !ANTHROPIC_KEY); // Gemini needs only Google sign-in
/* the day's AI budget (budget.js): one ceiling for the server and a share for each brand (DAILY_BRAND_SHARE, BRAND_<KIND>_CAP),
   kept in the bucket with treg's day total and loaded before the first call (await budget.load() below) */
const budget = createBudget({ store: { get: () => packs.getJSON('_brew', 'usage-day.json', null), put: (x) => packs.put('_brew', 'usage-day.json', { ...x, treg: { day: treg.meter.day, usd: treg.meter.dayUsd } }) }, log: console });
const CAPS = budget.caps.all;
const spend = (k, slug, n) => budget.spend(k, slug, n);
// the system prompt is the active brand's brief (the generated brief.md)
const SYSTEM = () => B()?.system || '';

// ---------- guardrails ----------
const BANNED = liveRe((b) => b.bannedRe); // the claim words this brand's category can't use
const clean = (s) => String(s || '').replace(/—/g, ',').replace(/ ,/g, ',').replace(/\\n/g, '\n').replace(/\u2039(?=\s?\d)/g, '₹');

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
  try { return realNewlines(JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))); } /* line breaks as real ones, ₹ never ‹ (QA-02, QA-08) */
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
  try { return realNewlines(JSON.parse(t)); } catch (e) { console.error('[claudeTool]', name, msg.stop_reason, t.slice(0, 300)); throw e; }
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
const IMAGE_FALLBACK = process.env.GEMINI_IMAGE_FALLBACK || 'gemini-3-pro-image';
/* refFiles: more reference pictures after the product photo (image 2, 3…), e.g. a rival's ad as the look for "Make our version" */
async function geminiOnce({ srcFile, refFiles = [], prompt, ratio, model }) {
  const t = await gToken();
  const parts = [];
  for (const f of [srcFile, ...refFiles].filter(Boolean)) { const b = fs.readFileSync(f); parts.push({ inlineData: { mimeType: IMG_MIME(b), data: b.toString('base64') } }); }
  parts.push({ text: prompt });
  const url = `https://aiplatform.googleapis.com/v1/projects/${GPROJECT}/locations/global/publishers/google/models/${model}:generateContent`;
  const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'x-goog-user-project': GPROJECT, 'content-type': 'application/json' }, signal: AbortSignal.timeout(120e3),
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio || '1:1' } } }) });
  if (!r.ok) { const t = await r.text(); noteVertex(r.status, t); throw new Error(`Gemini ${model} ${r.status}: ${t.slice(0, 300)}`); }
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
/* four answers (image-guard.js acts on each): SAME keeps the picture; TEXT (the right product, its name misspelled in large
   letters) is made once more; DIFFERENT is made again stricter, then the real photo stands in; NOREF (image 1 is a logo, a
   graphic or a screenshot, not a product photo) moves to another catalog photo. Blurred or garbled small print is SAME: of 54
   pictures thrown away on 16 Oct, 47 showed the right product. `same` stays for callers that read only it (TEXT is not same) */
const sameProduct = async (refFile, buf, name) => {
  if (!anthropic || process.env.AI_MOCK === '1' || process.env.IMAGE_CHECK === '0') return { same: true, text: false, noref: false, why: 'check off' };
  const ref = fs.readFileSync(refFile), img = (b) => ({ type: 'image', source: { type: 'base64', media_type: IMG_MIME(b), data: b.toString('base64') } });
  const msg = await anthropic.messages.create({ model: process.env.IMAGE_CHECK_MODEL || 'claude-haiku-5-5', max_tokens: 400, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: [
    { type: 'text', text: `Image 1 is the real product${name ? ` (${name})` : ''}. Image 2 is a new ad picture. Ignore the scene, the light and the setting. Reply with one word, then a short reason. SAME: the same product (type, shape, colours, pack design, number of items), even if small print is blurred, misspelled or unreadable, a small tag is added or missing, or the angle differs. TEXT: the same product, but its brand or product name is clearly misspelled in large letters. DIFFERENT: another product type, shape, colour, pack design or number of items. NOREF: image 1 is not a product photo (a logo, a graphic, a screenshot).` },
    img(ref), img(buf)] }] });
  const t = (msg.content || []).map((x) => x.text || '').join(' ').trim(), m = /^\W*(same|text|different|noref)\b/i.exec(t); if (!m) throw new Error(`no verdict (${msg.stop_reason})`);
  const w = m[1].toLowerCase(); return { same: w === 'same' || w === 'noref', text: w === 'text', noref: w === 'noref', verdict: w, why: t.slice(0, 160) };
};
/* the draft image chain (media.js): Vertex Gemini (both models), then OpenAI gpt-image-1; the jam's image chip puts GPT Image
   first when it is picked. Sloosh never sits here: it makes finals only, behind a button, through finals.js */
const openaiImage = (o) => openaiImageRaw(o, { readFile: (f) => fs.readFileSync(f) });
const rawImage = async (o, { gptFirst = false } = {}) => {
  /* GPT Image takes the product photo only: a picture with a look reference (our version of a rival's ad) stays on Gemini, so
     the look is never silently dropped */
  const steps = [['gemini', () => rawGeminiImage(o)], ['gpt-image', OPENAI_KEY && !o.refFiles?.length && (() => openaiImage(o))]];
  if (gptFirst) steps.reverse();
  return (await mediaChain('image', steps, console)).buf;
};
/* SVG, GIF, AVIF or HEIC product photos become PNGs before any model or check sees them (img-norm.js) */
const imgNorm = createImageNorm({ withBrowser, log: console });
const geminiImage = createImageGuard({ balance: balanceWarm, gen: (o) => rawImage(o), verify: sameProduct, fetchPhoto: photoAny, resolve: (f) => resolveLocal(f), normalize: imgNorm.normalize, context: inBrand, log: console });
/* every picture the build (ad statics, the team's statics), background drafts and story watchers make counts against the day's
   image budget, the brand's share first (budget.js). The jam's own routes count theirs before calling imageGen */
const countedImage = async (o = {}) => { if (!spend('image', o.slug)) throw Object.assign(new Error(budget.why('image', o.slug) || 'The image budget for today is used up.'), { soft: true, budget: true }); return geminiImage(o); };
const imageGen = createImageGuard({ balance: balanceWarm, gen: (o) => rawImage(o, { gptFirst: prefs().image === 'gpt-image' && !!OPENAI_KEY && !!o.srcFile && !o.refFiles?.length }), verify: sameProduct, fetchPhoto: photoAny, resolve: (f) => resolveLocal(f), normalize: imgNorm.normalize, context: inBrand, log: console });

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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.zip': 'application/zip', '.pdf': 'application/pdf', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
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
const photoFile = makePhotoFile(PUB, BRANDS_DIR); /* never outside public/ or a brand's assets (safe-path.js) */
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

/* the brand a page asks about (/api/config?brand=), else the one in hand: whose share of today's budget it is shown */
const cfgSlug = (req) => { const q = String(new URL(req?.url || '/', 'http://x').searchParams.get('brand') || '').replace(/[^a-z0-9-]/g, ''); return q && !blocked(q) ? q : undefined; };
const routes = {
  'GET /api/research': async () => { const r = B().research; return { ...r.get(), running: r.running(), spent: r.spent() }; },
  'POST /api/research/refresh': async (b, req) => { if (!(await genOk(req, B().slug))) return demoErr(); const ok = ['ads', 'trends', 'news', 'howto', 'viral']; const which = (b.sources || ok.slice(0, 4)).filter((k) => ok.includes(k)); B().research.refresh(which); return { started: which }; },
    /* paid work running on this instance now: counts by kind, never brand names. Nothing waits on it: deploys go any time
       (the instance that goes saves what it has, the next resumes it) */
  'GET /api/ops/busy': async () => { const by = { ...(builder?.paidWork?.() || {}), drafts: draftsBg?.busy?.() || 0, cadence: movesCadence?.busy?.() || 0, finals: finals?.busy?.() || 0 };
    return { busy: Object.values(by).reduce((a, n) => a + n, 0), by, rev: process.env.K_REVISION || null }; },
  'GET /api/ops/sloosh': async (b, req) => slooshOps(req),
  /* SquareUp staff: listen for one brand now (a brand whose run was cut off, or one a customer is waiting on). Same caps */
  'POST /api/ops/listen': async (b, req) => { if (!auth.isAdmin(auth.user(req))) return { error: 'admins only' }; const slug = String(b?.slug || '').replace(/[^a-z0-9-]/g, ''); if (!slug || blocked(slug)) return { error: 'unknown brand' };
    const due = await social.due(slug); if (due.why?.some((w) => /off here|mock/.test(w))) return { error: due.why.join('; ') };
    social.runOne(slug, { ...due, listen: true, listenFull: b.full !== false, ideas: false }).catch((e) => console.warn('[ops] listen', slug, e.message)); return { started: slug }; },
  'GET /api/config': async (b, req) => ({ ai: MOCK ? 'mock' : 'live', provider: PROVIDER, paused: !MOCK && aiPaused(), image: !!(GPROJECT || OPENAI_KEY), caps: CAPS, used: budget.state.all, share: budget.left(cfgSlug(req)), brandCaps: budget.caps.brand }),
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
/* the day's usage survives a restart or a deploy: AI calls by kind (all brands and each brand) and treg dollars, read back before
   anything can spend (the brands, background jobs and the server all start after this line) */
await budget.load();
await packs.getJSON('_brew', 'usage-day.json', null).then((j) => { const d = new Date().toDateString();
  if (j?.treg?.day === d && j.treg.day === treg.meter.day) treg.meter.dayUsd = Math.max(treg.meter.dayUsd, +j.treg.usd || 0); }).catch(() => {});
treg.onCharge(() => budget.touch());
/* ops alerts to the ShopOS team (alerts.js): once per issue per day, the day's list in the bucket */
const alerts = createAlerts({ treg, log: console, store: { get: () => packs.getJSON('_brew', 'alerts.json', null), put: (x) => packs.put('_brew', 'alerts.json', x) },
  sendMail: async ({ to, subject, html, text }) => { const key = process.env.RESEND_API_KEY; if (!key) throw new Error('no RESEND_API_KEY');
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: process.env.NOTIFY_FROM || 'Brew <hello@send.joinsquareup.com>', to: [to], subject, html, text }) });
    if (!r.ok) throw new Error(`resend ${r.status}`); } });
alerts.start();
configureGen({ dir: GEN, researchDir: path.join(PUB, 'research'), bucket: BUCKET, gToken, log: console });
const store = createStore({ dir: path.join(ROOT, '.tenants'), bucket: BUCKET, gToken });
// each brand gets its own research (story rings) and live watchers. A generated brand gets them once its read is in
// (they need its rivals, search terms, questions and country); until then a quiet stand-in answers.
const STUB = { get: () => ({}), running: () => [], spent: () => ({}), onRefresh: () => {}, refresh: () => [], mediaFile: async () => null, start: async () => {}, ready: async () => {}, need: () => false };
const INST = new Map(); // slug → { key, research, live }
const attach = (p) => {
  if (!p) return p;
  if (p.kind === 'generated') setTimeout(() => notesSvc?.fill(p).catch((e) => console.warn('[notes]', p.slug, e.message)), 5000); /* margin notes for cards that never had one */
  if (p.kind === 'generated') setTimeout(() => valueSvc?.fill(p).catch((e) => console.warn('[move-value]', p.slug, e.message)), 8000); /* grades for moves new or rewritten since the last grading */
  const c = p.config || {}, key = JSON.stringify([c.rivals, c.terms, c.questions, c.country, c.catalogUrl, p.name]);
  /* a brand waiting on "Check what we read" runs no research or watchers: nobody has asked for the moves yet, and a restart
     must not pay for them again (confirm-remind.js reminds the team instead) */
  const held = p.kind === 'generated' && awaitingCheck(p.status);
  /* questions not yet sourced from real searches: sourced once in the background, and a brand with no watchers yet waits for them,
     so its first weekly AI check asks the sourced set instead of asking the read's guesses and then asking again (~30 s) */
  const needQ = p.kind === 'generated' && p.ready && !held && questionsHeal(p), waitQ = needQ && !INST.get(p.slug) && !QDONE.has(p.slug);
  const read = p.kind !== 'default' && (c.questions?.length || c.rivals?.length) && !held && !waitQ; // the default context runs no watchers
  let x = INST.get(p.slug);
  if (held && x) { try { x.live?.stop?.(); x.research?.stop?.(); } catch {} INST.delete(p.slug); x = null; }
  if (read && (!x || x.key !== key)) {
    if (x) { try { x.live?.stop?.(); x.research?.stop?.(); } catch {} } /* the replaced watchers stop: no duplicate timers or catalog signals */
    const params = (m, max) => ({ ...claudeParams(m, max), system: p.system });
    x = { key, research: createResearch({ ROOT, PUB, anthropic, claudeParams: params, textOf, geminiImage: countedImage, gToken, clean, factBrief: () => (packs.peek(p.slug) || p).factBrief, brand: p, photoFile, tregClient: treg, videoRead: (m, a) => videoRead[m](a) /* lazy: videoRead is made further down */ }),
      live: createLiveWatch({ ROOT, anthropic, claudeParams: params, textOf, gToken, brand: p, tregClient: treg, namePass: (as) => namedPass(p, as) }) };
    INST.set(p.slug, x);
    x.research.start().catch((e) => console.error('[research] start', p.slug, e.message)); x.live.start().catch((e) => console.error('[live] start', p.slug, e.message));
    p.research = x.research; p.live = x.live; feedSvc?.wire(p);
    // the catalog watch saw something new: the builder decides if the moves need a fresh look
    x.live.onRefresh((done) => { if (!done.includes('catalog')) return; try { const c = x.live.get().catalog; builder.signal(p.slug, (c?.events || []).filter((e) => e.at === c.fetchedAt)).catch(() => {});
      /* stock is a state, not news: every pass hands over what is out and what is in, so a product that was already out (its
         event seen before) still marks its moves; stockSignal acts only on what changed since the last pass */
      const its = c?.items || []; if (its.length) builder.stockSignal?.(p.slug, [{ kind: 'oos', items: its.filter((i) => i.inStock === false) }, { kind: 'back', items: its.filter((i) => i.inStock !== false) }, { kind: 'new', items: its }]).catch(() => {}); } catch {} });
  }
  p.research = x?.research || STUB; p.live = x?.live || STUB;
  return p;
};
const loadBrand = async (slug, o) => blocked(slug) ? null : attach(await packs.load(slug, o));
/* a brand's AI answers questions, sourced from real demand (ai-questions.js) the first time it loads after this shipped, and when
   Q_V moves on. The new set goes into config.json (the team's own questions kept), the pack reloads, and the weekly check sees a
   new set and asks it on its next tick. One try per brand every 6 hours if it can't find enough evidence */
let AIQ = null; const QHEAL = new Map(), QDONE = new Set(); /* QDONE: the heal ended (sourced or not), so the watchers start either way */ const aiq = () => (AIQ ||= createAiQuestions({ packs, treg, ai, log: console })); /* made on first use: `ai` is declared further down */
/* true while the brand's questions still need sourcing (the caller waits on QDONE before starting its watchers) */
const questionsHeal = (p) => {
  if (MOCK || process.env.DEMO_MODE === '1' || process.env.QUESTIONS_OFF === '1' || p.config?.questionsV === Q_V) return false;
  const slug = p.slug; if (Date.now() - (QHEAL.get(slug) || 0) < 6 * 3600e3) return !QDONE.has(slug); QHEAL.set(slug, Date.now()); QDONE.delete(slug);
  const done = () => { if (QDONE.has(slug)) return; QDONE.add(slug); packs.drop(slug); loadBrand(slug).catch(() => {}); }; /* the watchers start, sourced or not */
  const guard = setTimeout(done, 4 * 60e3); guard.unref?.(); /* a sourcing that hangs never keeps a brand's watchers off */
  (async () => {
    await new Promise((res) => setTimeout(res, 3000)); /* after boot: never before `ai` exists, and never in the way of the page load */
    const r = await aiq().source(slug);
    if (!r.ok) { console.warn('[ai-questions]', slug, `only ${r.questions.length} questions with evidence`, r.method.errors.join('; ')); return done(); }
    const c = (await packs.getJSON(slug, 'config.json', {})) || {};
    await packs.put(slug, 'config.json', { ...c, questions: r.questions, questionsV: Q_V, questionsMethod: r.method, rivalsAI: r.rivals.length ? r.rivals : c.rivalsAI || c.rivals || [] });
    console.log('[ai-questions]', slug, `${r.questions.length} questions from ${r.method.candidates} candidates (${r.method.sources.join(', ')})`);
    done();
  })().catch((e) => { console.warn('[ai-questions]', slug, e.message); done(); }).finally(() => clearTimeout(guard));
  return true;
};
/* which brands each weekly AI answer names, by the read's own pass (reader/stages/named.js) on the fast model */
const namedPass = async (p, as) => {
  if (MOCK) throw new Error('AI is off');
  const prof = { name: p.name, brandName: p.config?.brandName || p.profile?.brandName || null, ai: { answers: as.map((a) => ({ text: a.text || [a.said, a.excerpt].filter(Boolean).join(' '), entities: a.brands || [] })) } };
  await namedStage({ profile: prof, aiOn: true, ai: (o) => ai.call(o) });
  prof.ai.answers.forEach((x, i) => { as[i].brandsNamed = x.brandsNamed || []; });
};
const brandPacks = { load: loadBrand, peek: (slug) => packs.peek(slug) };
setDefaultBrand(await loadBrand(DEFAULT));
const ai = createAI({ apiKey: ANTHROPIC_KEY, mock: process.env.AI_MOCK === '1' || (PROVIDER === 'anthropic' && !ANTHROPIC_KEY) });
/* margin notes (notes.js): one Sonnet call per brand for cards never considered, about $0.05; on Cloud Run, or locally with NOTES_BG=1 */
/* move grades for the ranker (value.js): one Sonnet call per 20 moves, once per move version, about $0.10 a brand */
const valueSvc = createValue({ ai, packs, log: console, allow: () => !MOCK && (!!process.env.K_SERVICE || process.env.NOTES_BG === '1') });
const notesSvc = createNotes({ ai, packs, log: console, allow: () => !MOCK && (!!process.env.K_SERVICE || process.env.NOTES_BG === '1') });
const tregLedger = spendLedger(treg, packs, { log: console }); /* flushed on SIGTERM below */
/* Apify spend lands in the same per-brand month file, tagged apify<what> (shelf.js reads it for the $10 brand cap) */
const apifyLedger = spendLedger({ onCharge: (f) => onAnyApifyCharge((tag, usd) => f(String(tag || '').replace(/^([a-z0-9]+)-/i, 'apify$1-'), usd)) }, packs, { log: console });
const apifyPulse = createApify({ log: console });
const calendar = createCalendar({ packs, ai, log: console });
const builder = createBuilder({ ROOT, packs, ai, treg, image: countedImage, log: console, signGate: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.FEED_SIGNIN !== '0' && process.env.BUILD_SIGNIN !== '0'),
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
  onFresh: async (slug) => { forgetSocial(slug); packs.drop(slug); attach(await packs.load(slug)); feedSvc?.syncSocial(slug); connectors?.drop(slug); await feedSvc?.refreshLive(slug).catch(() => {}); /* the team's ideas */ } });
social.start();
/* ---------- evidence in the background: market numbers once a day (only the signals that are due run), and a weekly read of the top
   videos people talk about. Same switches as social (SOCIAL_BG / RESEARCH_OFF / LIVE_OFF, off under AI_MOCK); EVIDENCE_OFF=1 stops it ---------- */
const EV = { busy: false, last: {} }, evOff = () => process.env.EVIDENCE_OFF === '1' || process.env.AI_MOCK === '1' || process.env.SOCIAL_BG === '0' || (process.env.SOCIAL_BG !== '1' && (!!process.env.RESEARCH_OFF || !!process.env.LIVE_OFF));
const videoRead = createVideoRead({ packs, treg, ai, apify: createApify({ log: console }), log: console, gToken }), VIDEO_V = 2; /* apify: YouTube clips (video-read mediaUrl) */
async function evidenceTick() {
  if (EV.busy || evOff()) return; EV.busy = true;
  try { const brands = (await builder.list()).filter((b) => b.state === 'Ready' || /moves/.test(b.state || '')), day = new Date().toISOString().slice(0, 10); let n = 0;
    for (const b of brands) { if (n >= 2) break; const st = (await packs.getJSON(b.slug, 'pulse/state.json', null).catch(() => null)) || {};
      if (EV.last[b.slug] === day || String(st.at || '').slice(0, 10) === day) continue; EV.last[b.slug] = day; n++;
      try { const r = await createPulse({ slug: b.slug, packs, treg, ai, apify: apifyPulse, log: console }).run(); console.log('[pulse]', b.slug, r.lines?.length || 0, 'lines', `$${(r.usd || 0).toFixed(3)}`);
        /* a rival moved (a price change or a launch on its store): the move it hits hardest is rewritten (at most one a day) */
        const ev = [...(r.lines || []).filter((l) => /^catalog\.(price|new)\./.test(l.key) && +l.value > 0).map((l) => ({ kind: l.key.startsWith('catalog.price.') ? 'rival-price' : 'rival-launch', subject: l.subject, items: l.items })),
          /* a rival's price moved 10%+ on a shelf or marketplace */ ...(r.lines || []).filter((l) => /^shelf\..+\.changes$/.test(l.key)).flatMap((l) => (l.changes || []).filter((c) => c.kind === 'price' && !c.own).map((c) => ({ kind: 'rival-price', subject: c.who, items: [`${c.name}: ${c.from} → ${c.to} on ${l.source}`] })))];
        if (ev.length) builder.signal(b.slug, ev).catch((e) => console.warn('[pulse] signal', e.message)); } catch (e) { console.warn('[pulse]', b.slug, e.message); }
      // once a week: read the most-talked-about videos heard for the brand (hooks for the jam and the creative moves)
      const vs = await packs.getJSON(b.slug, 'video/state.json', null).catch(() => null);
      if (!vs || vs.v !== VIDEO_V || Date.now() - (vs.at || 0) > 7 * 864e5) { try { /* VIDEO_V: reads before the link/id fix all failed, so every brand reads once more */ const it = (await packs.getJSON(b.slug, 'listen/items.json', null))?.items || [];
        const vids = it.filter((x) => /tiktok|instagram|youtube/.test(x.platform) && x.kind === 'post' && x.link).sort((a, c) => (c.likes || 0) - (a.likes || 0));
        await videoRead.readTop({ slug: b.slug, items: vids, n: 3, why: 'top talked-about videos' }); await packs.put(b.slug, 'video/state.json', { at: Date.now(), v: VIDEO_V }); } catch (e) { console.warn('[video]', b.slug, e.message); } } }
    // once a week, for every brand at once: estimated festival and sale dates checked against what organisers have announced
    const cs = await packs.getJSON('_brew', 'calendar/confirm-state.json', null).catch(() => null);
    if (!cs || Date.now() - (cs.at || 0) > 7 * 864e5) { const r = await calendar.confirmDates({ treg }).catch((e) => ({ error: e.message })); await packs.put('_brew', 'calendar/confirm-state.json', { at: Date.now(), last: r }); console.log('[calendar] confirm', JSON.stringify(r).slice(0, 200)); }
  } finally { EV.busy = false; } }
setInterval(() => evidenceTick().catch((e) => console.warn('[evidence]', e.message)), 30 * 60e3).unref?.(); setTimeout(() => evidenceTick().catch(() => {}), 5 * 60e3).unref?.();
/* ---------- moves on a cadence (moves-cadence.js): audit, listening and automation moves for every built brand, weekly. Cap MOVES_WEEK_CAP_USD (default $3 a brand a week),
   kill switch MOVES_REFRESH_OFF=1; off under AI_MOCK and on local servers unless MOVES_BG=1. Manual: POST /api/brands/:slug/moves/refresh (team-only on claimed brands) ---------- */
const movesCadence = createMovesScheduler({ packs, ai, memory: MEMORY_ON() ? memory : null, cardsGen: createCardsGen, log: console,
  onPack: async (slug) => { packs.drop(slug); attach(await packs.load(slug)); social?.kick?.(); /* a brand that just became ready is heard first (social-feed.js) */ }, onCards: (slug, cards, o) => { if (o?.private) connectors?.drop(slug); feedSvc?.addCards(slug, cards, o); } /* the team's run: members only */, dropCards: (slug, ids) => { connectors?.drop(slug); feedSvc?.dropCards(slug, ids); }, pdfFor: null /* PDFs are made on download (builder.pdfOn) */ });
movesCadence.start();
/* ---------- a one-off paid check of the team-only views (OPS_TEAM_PROBE=<slug,...>), for a brand with real accounts connected:
   one weekly automation run (public and team), one team ideas run and the team's static ads from its Move 21. Once per brand
   (private/ops-team-probe.json keeps what it made and what it cost); remove the variable after ---------- */
async function teamProbe(slug) {
  const M = 'private/ops-team-probe.json'; if (await packs.getJSON(slug, M, null).catch(() => null)) return;
  if (!realRows(await packs.getJSON(slug, 'private/connected-ledger.json', []).catch(() => [])).length) return console.warn(`[ops] team probe ${slug}: no real connected account`);
  await packs.put(slug, M, { startedAt: Date.now() });
  const usd = () => +(ai.meter.usd + (treg?.meter?.usd || 0)).toFixed(4), img = () => budget.state.all.image, out = { startedAt: Date.now() };
  const step = async (k, fn) => { const u0 = usd(), i0 = img(); try { out[k] = { ...(await fn()) }; } catch (e) { out[k] = { error: e.message }; } out[k].usd = +(usd() - u0).toFixed(4); out[k].images = img() - i0; console.log(`[ops] team probe ${slug} ${k}:`, JSON.stringify(out[k]).slice(0, 400)); };
  await step('auto', async () => { const r = await movesCadence.runOne(slug, ['auto'], { manual: true }); return { written: (r.written || []).map((w) => w.n), team: (r.privWritten || []).map((w) => w.n), errors: r.errors }; });
  await step('ideas', async () => { const r = await createIdeas({ slug, packs, ai, treg, log: console, member: true }).next({ n: 6 }); return { made: r.ideas.length, dropped: r.dropped?.length || 0 }; });
  await step('statics', () => builder.teamStatics(slug));
  connectors?.drop(slug); await feedSvc?.refreshLive(slug).catch(() => {});
  await packs.put(slug, M, { ...out, doneAt: Date.now() });
}
if (process.env.OPS_TEAM_PROBE && !MOCK) setTimeout(() => { (async () => { for (const sl of String(process.env.OPS_TEAM_PROBE).split(',').map((x) => x.trim()).filter(Boolean)) await teamProbe(sl).catch((e) => console.error('[ops] team probe', sl, e.message)); })(); }, 120e3).unref?.();
/* ---------- brand learnings (brand-learnings.js): the team pastes a call transcript, notes or emails into a jam; Brew learns the essence,
   goals, beliefs and facts (each with its source), updates the brief, memory and system prompt, flags and rewrites the moves it changes
   (build.js rewrite caps, LEARN_REWRITE_MAX, default 4) and writes new ones (the cadence "learn" family, under MOVES_WEEK_CAP_USD).
   About $0.03 per 14k characters read; LEARN_DAY_MAX sources a brand a day (default 12) ---------- */
const learnings = createLearnings({ ai, packs, memory: MEMORY_ON() ? memory : null, builder, cadence: movesCadence, feed: { addCards: (slug, cards) => feedSvc?.addCards(slug, cards) } /* the team's new cards reach every open workspace at once */, log: console, onPack: async (slug) => { packs.drop(slug); attach(await packs.load(slug)); } });
/* ---------- the fact sheet (facts-desk.js): the team corrects facts any time; a free daily price and stock check against the store's
   products.json (brands opened in the last 7 days); connected accounts become the source of truth (members only).
   Kill switch FACTS_DAILY_OFF=1; off under AI_MOCK and on local servers unless FACTS_BG=1 ---------- */
const factsDesk = createFactsDesk({ packs, builder, ai, log: console, onPack: async (slug) => { packs.drop(slug); attach(await packs.load(slug)); } });
builder.setHooks({ connected: (slug, tool) => factsDesk.connected(slug, tool), newMoves: (slug) => learnings.runPendingLearn(slug) });
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
/* background first drafts never use the last of a brand's day: a share is kept for what people ask for in the jam (on 17 Oct
   background clips used every video before anyone asked for one). BG_RESERVE_<KIND> overrides */
const BG_RESERVE = { image: +(process.env.BG_RESERVE_IMAGE ?? 40), video: +(process.env.BG_RESERVE_VIDEO ?? 8), voice: +(process.env.BG_RESERVE_VOICE ?? 10) };
const bgSpend = (k, slug) => { if (BG_RESERVE[k] != null) { const l = budget.left(slug)?.[k]; if (l && l.left <= BG_RESERVE[k]) return false; } return spend(k, slug); };
const bgImage = async (o = {}) => { const l = budget.left(o.slug)?.image; if (l && l.left <= BG_RESERVE.image) throw Object.assign(new Error('Pictures are kept for the team for the rest of today.'), { soft: true, budget: true }); return countedImage(o); };
const draftsBg = createDraftsBg({ packs, ai, geminiImage: bgImage, saveGen, genFile, photoAsync, treg, launchBrowser, zipBuffer, spend: bgSpend, memory: MEMORY_ON() ? memory : null, loadPack: (slug) => packs.load(slug), log: console,
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
/* sign-in off on Cloud Run (FEED_SESSION_SECRET or GOOGLE_CLIENT_ID missing) would open every team-only read to everyone: the
   instance refuses to boot instead. OPEN_SITE=1 says that is meant (a local-style open server) */
if (process.env.K_SERVICE && !auth.signinOn() && process.env.OPEN_SITE !== '1') throw new Error('[auth] sign-in is not configured (FEED_SESSION_SECRET / GOOGLE_CLIENT_ID): refusing to boot with every team-only read open. Set OPEN_SITE=1 only on purpose.');
/* Brew's own Sloosh workspace (sloosh-auth.js): staff sign in once; every brand's finals spend from it (finals.js, a later batch) */
const slooshAuth = createSlooshAuth({ packs, vault: createVault(packs), auth, log: console });
const sloosh = createSloosh({ tokenFor: slooshAuth.tokenFor, log: console });
/* finals (finals.js): the go-live image or video a team asks Sloosh for, quote first, behind a button; records per brand so a
   restart never pays twice (reconcileAll at boot); counted in budget 'credits' and in /api/ops/busy */
const finals = createFinals({ sloosh, slooshAuth, packs, budget, saveGen, genFlush, slugs: async () => (await packs.list()).map((x) => x.slug), log: console, geminiImage: countedImage, photo: photoAny,
  onDone: async (slug, rec) => { const ok = await feedSvc?.finalDone?.(slug, rec); console.log(`[finals] ${slug} ${rec.runKey} ${rec.state} after the restart: ${ok ? 'landed on its card' : 'no card to land on'}`); return !!ok; }, /* a run reconcileAll settles lands where it was asked */ /* the Gemini fallback until Brew's workspace can pay: the drafts' own makers, counted in the image/video budget */
  makeVideo: async (frame, prompt, { ratio = '9:16', seconds = 6, slug } = {}) => { if (!spend('video', slug)) throw Object.assign(new Error(budget.why('video', slug) || 'The video budget for today is used up.'), { soft: true, budget: true }); return makeVideo(frame, prompt, { ratio, seconds }, console); } });
/* Sloosh's health for the ops alerts: when it needs a reconnect or can't pay, finals quietly go to Gemini, so staff hear it once a day */
if (process.env.K_SERVICE && process.env.DEMO_MODE !== '1' && process.env.AI_MOCK !== '1') { const slooshCheck = () => finals.status({ fresh: true }).then((st) => { if (!st.ok && !st.dummy) noteAlert('sloosh', st.fallbackWhy || st.why || 'not ready'); }).catch((e) => noteAlert('sloosh', e.message));
  setTimeout(slooshCheck, 120e3).unref?.(); setInterval(slooshCheck, 3600e3).unref?.(); }
/* GET /api/ops/sloosh (staff): the connection, the workspace and what Sloosh says about today's limit and credits */
const slooshStaff = (req) => auth.isAdmin(auth.user(req)) || (!auth.signinOn() && !process.env.K_SERVICE); /* staff, or a local server with sign-in off */
const slooshOps = async (req) => {
  if (!slooshStaff(req)) return { error: 'Brew staff only' };
  const fin = await finals.status({ fresh: true }).catch((e) => ({ ok: false, why: e.message }));
  const st = await slooshAuth.status(); if (!st.connected) return { ...st, connect: '/api/ops/sloosh/connect' };
  const [conn, acct] = await Promise.all([sloosh.getConnection().catch((e) => ({ error: e.message })), sloosh.getAccount().catch((e) => ({ error: e.message }))]);
  const ws = conn?.workspace || acct?.workspace || null; if (ws && !st.workspace) await slooshAuth.setWorkspace(ws).catch(() => {});
  /* preflight: the live tool schemas against the words finals send (free, nothing is called); ?quote=1 also asks for a real quote
     on a plain image brief, which reserves and spends nothing (a quote is only a price until a yes runs it) */
  const pre = await sloosh.preflight().catch((e) => ({ ok: false, error: e.message }));
  let quote = null; if (new URL(req.url, 'http://x').searchParams.get('quote') === '1') { const b = buildFinal({ kind: 'image', title: 'a Meta ad', visual: 'A hand holds the product on a desk by a window.', hasSrc: false, ratio: '4:5', brand: { name: 'Brew check' } });
    quote = await sloosh.quoteGeneration({ mode: 'image_gen', prompt: b.prompt, model: b.model, references: [], ratio: b.settings.aspect_ratio, resolution: b.settings.resolution, count: 1 }).then((q) => ({ ok: true, model: b.model, credits: pick(q, 'credits', 'expectedCredits') ?? null, expiresAt: pick(q, 'expiresAt') || null, warning: pick(q, 'warning') || null })).catch((e) => ({ ok: false, model: b.model, error: e.message })); }
  /* ?models=1: what Sloosh's models really take today (list_models, free); ?quote=video&brand=<slug>[&img=<https url>]: real free quotes
     on that brand's product photo, the reel as Brew sends it and one setting changed per variant (finals.probe) */
  const sp = new URL(req.url, 'http://x').searchParams; let models = null, probe = null;
  if (sp.get('models') === '1') models = Object.fromEntries(await Promise.all(['image_gen', 'video_gen'].map(async (m) => [m, await sloosh.listModels(m).catch((e) => ({ error: e.message }))])));
  if (sp.get('quote') === 'video') { const slug = sp.get('brand') || 'cozysnugglet-shop'; const b = await loadBrand(slug).catch(() => null); const lead = (b?.catalog || []).find((x) => x.img) || null;
    const img = sp.get('img') || lead?.img || null; probe = { brand: slug, ...(await finals.probe(slug, img, { label: lead?.t || lead?.title || 'Product photo' }).catch((e) => ({ error: e.message }))) }; }
  /* ?final=1&brand=<slug>[&frame=<gen/... still>]: finals.quote itself (live fit, references, start frame, the 720p retry) on a reel and an
     image as the studio builds them, on the brand's lead product photo; free, nothing is kept */
  let finalCheck = null; if (sp.get('final') === '1') { const slug = sp.get('brand') || 'cozysnugglet-shop'; const b = await loadBrand(slug).catch(() => null); const lead = (b?.catalog || []).find((x) => x.img) || null;
    const prod = lead ? { url: lead.img, job: 'product', label: lead.t || lead.title || 'Product' } : null, frame = sp.get('frame');
    const base = { title: 'a reel', subject: prod?.label, visual: 'A hand picks the product up from a kitchen counter and uses it.', brand: { name: b?.seed?.brand?.name || slug }, brandName: slug };
    const show = (q) => (q?.error ? { error: q.error, detail: q.detail || null } : { provider: q.provider, model: q.model, credits: q.credits, hold: q.hold, settings: q.settings, refs: (q.refs || []).map((r) => `${r.job}/${r.role || 'reference'}`), fallbackWhy: q.fallbackWhy || null, warning: q.warning || null, promptStart: String(q.prompt || '').slice(0, 300) });
    const video = { ...base, kind: 'video', ratio: '9:16', seconds: +sp.get('seconds') || 9, sound: true, beats: [{ shot: 'A hand reaches for the product.', line: 'This one changed my mornings.' }, { shot: 'Close on it in use.', line: '' }, { shot: 'Back on the counter.', line: 'Try it.' }], refs: [prod, ...(frame ? [{ url: frame, job: 'frame' }] : [])].filter(Boolean) };
    const image = { ...base, kind: 'image', ratio: '4:5', text: [], refs: [prod, ...(frame ? [{ url: frame, job: 'layout' }] : [])].filter(Boolean) };
    finalCheck = { brand: slug, reel: show(await finals.quote(slug, video).catch((e) => ({ error: e.message }))), image: show(await finals.quote(slug, image).catch((e) => ({ error: e.message }))) }; }
  return { ...st, workspace: ws || st.workspace, connection: conn, account: acct, finals: fin, ...(finalCheck ? { finalCheck } : {}), credits: budget.left().credits, preflight: pre, ...(quote ? { quote } : {}), ...(models ? { models } : {}), ...(probe ? { probe } : {}), refusals: finals.refusals(), tries: finals.tries?.() || [], reconnect: '/api/ops/sloosh/connect' };
};
const slooshHandle = async (req, res, u) => {
  if (!u.pathname.startsWith('/api/ops/sloosh/')) return false;
  const go = (to) => { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end(); return true; };
  const me = auth.user(req); if (!me && auth.signinOn()) return go(`/auth/google?next=${encodeURIComponent('/api/ops/sloosh/connect')}`);
  if (!slooshStaff(req)) return send(res, 403, { error: 'Brew staff only' }), true;
  if (u.pathname === '/api/ops/sloosh/connect' && req.method === 'GET') { try { return go(await slooshAuth.connectUrl(req, res)); } catch (e) { return send(res, 200, { error: e.message }), true; } }
  if (u.pathname === '/api/ops/sloosh/callback' && req.method === 'GET') {
    try { await slooshAuth.callback(req, u); sloosh.reset(); finals.forget(); const ws = await sloosh.getConnection().then((c) => c?.workspace || null).catch(() => null); if (ws) await slooshAuth.setWorkspace(ws);
      return go(`/#ops=sloosh&done=1`); }
    catch (e) { console.warn('[sloosh] callback', e.message); return go(`/#ops=sloosh&err=${encodeURIComponent(e.message)}`); }
  }
  if (u.pathname === '/api/ops/sloosh/disconnect' && req.method === 'POST') { await slooshAuth.disconnect(); sloosh.reset(); finals.forget(); return send(res, 200, { ok: true }), true; }
  return false;
};
/* Brew's emails about jams to the brand's team: tagged, asked, assigned, needs your OK right away; replies batched (jam-mail.js) */
/* a brand waiting on "Check what we read": email the person who started the read and its admins after a few hours, and once
   more a day later (never auto-confirmed). Live site only: the demo sends no email, local servers only with CONFIRM_REMIND=1 */
if (!DEMO && process.env.CONFIRM_REMIND !== '0' && (process.env.K_SERVICE || process.env.CONFIRM_REMIND === '1')) createConfirmRemind({ packs, mail: (...a) => auth.mail(...a), log: console }).start();
const jamMail = createJamMail({ mail: (...a) => auth.mail(...a), packs, sign: auth.sign, verify: auth.verify, brandName: (slug) => packs.peek(slug)?.seed?.brand?.name || slug, watching: (wid, email) => !!feedSvc?.jams?.watching?.(wid, email), log: console });
/* the weekly digest (digest.js): each Ready brand's team hears on Monday morning, brand time, what changed in Brew (from saved files,
   no AI); its Slack channel too when connected. Live site only (Cloud Run, or DIGEST=1 locally), never the demo; DIGEST_OFF=1 stops it */
if (!DEMO && process.env.DIGEST_OFF !== '1' && (process.env.K_SERVICE || process.env.DIGEST === '1')) import('./digest.js').then(({ createDigest }) => createDigest({ packs, mail: (...a) => auth.mail(...a), slack: () => connectors, prefLink: (slug, email) => jamMail.prefLink(slug, email, 'off'), log: console }).start()).catch((e) => console.warn('[digest] not started:', e.message));
/* Demo Mode: a visitor with no Google sign-in is the owner of their own demo session (demo-mode.js virtualFile) */
if (DEMO) { const realUser = auth.user; auth.user = (req) => realUser(req) || (demoSid() ? { email: demoEmail(), name: 'You', demo: true } : null); }
const memoryRoutes = createMemoryRoutes({ memory, viewerOf: (req, slug) => viewerOf(req, slug), readBody, send, enabled: MEMORY_ON, exists: async (slug) => !blocked(slug) && (!!(await packs.getJSON(slug, 'status.json', null))) }); // brand memory
const movesRoutes = movesCadence.routes({ viewerOf: (req, slug) => viewerOf(req, slug), readBody, send, exists: async (slug) => !blocked(slug) && slug !== DEFAULT && !!(await packs.getJSON(slug, 'status.json', null)) });
/* a store behind Shopify's password page, read from its admin (closed-gate.js): its team only, everyone else a plain "not open yet"
   page, until a heal finds it open. Live only: the demo site and a local server with sign-in off have nobody to tell apart */
const closedGate = createClosedGate({ status: (slug) => builder.status(slug), profile: (slug) => packs.getJSON(slug, 'profile.json', null), user: (req) => auth.user(req), roleOf: (slug, me) => auth.roleOf(slug, me),
  on: () => !DEMO && auth.signinOn(), ttl: process.env.CLOSED_GATE_TTL != null ? +process.env.CLOSED_GATE_TTL : 15e3, renew: (req, u, res) => shopifyApp?.renew?.(req, u, res) || null, log: console });
// is this person on the brand's team, and is the brand claimed (cached a minute: every feed call asks)
const MEMO = new Map();
/* every signed-in email that opens a brand, and what it got (Param, 23 Oct): _brew/private/visitors.json, one row per brand and
   email (first and last seen, how often, its access then). Counted when a verdict is worked out (not every request), written at most
   every 30 s and on SIGTERM; staff read it at GET /api/admin/visitors */
const VIS = { m: null, dirty: false, t: null }, VIS_FILE = 'private/visitors.json';
const visLoad = () => (VIS.m ||= packs.getJSON('_brew', VIS_FILE, {}).then((x) => x || {}).catch(() => ({})));
const visFlush = async () => { clearTimeout(VIS.t); VIS.t = null; if (!VIS.dirty) return; VIS.dirty = false; await packs.put('_brew', VIS_FILE, await visLoad()).catch((e) => console.warn('[visitors]', e.message)); };
const visSeen = (slug, me, v, a) => { const email = String(me?.email || '').toLowerCase(); if (!email || !slug || slug === DEFAULT || !a?.host || process.env.DEMO_MODE === '1') return; /* no host: no such brand */
  visLoad().then((m) => { const k = `${slug}|${email}`, r = (m[k] ||= { slug, email, first: Date.now(), n: 0 });
    r.last = Date.now(); r.n++; if (me.name) r.name = me.name;
    r.access = a.full ? 'brew' : v.member ? 'team' : v.gen ? 'official' : 'blocked'; /* brew: SquareUp; official: the brand's own email, unclaimed */
    if (r.access === 'blocked') r.blocked = (r.blocked || 0) + 1;
    VIS.dirty = true; VIS.t ||= setTimeout(visFlush, 30e3); }).catch(() => {}); };
const viewerOf = async (req, slug) => { if (process.env.DEV_MEMBER === '1' && !process.env.K_SERVICE && !auth.user(req)?.sub?.startsWith?.('dev')) return { member: true, claimed: true, gen: true, email: process.env.DEV_EMAIL || 'dev@local', name: process.env.DEV_NAME || 'Dev', seats: process.env.DEV_SEATS != null ? process.env.DEV_SEATS.split(',').filter(Boolean) : null }; // local testing of team-only paths; never on Cloud Run
  const me = auth.user(req), k = `${slug}|${me?.email || ''}`, c = MEMO.get(k); if (c && Date.now() - c.at < (c.v.gen ? 60e3 : 10e3)) return c.v; // a demo verdict is kept only briefly: an invite or claim on another instance shows up within seconds
  /* gen: may make fresh work here (the team, SquareUp, an official email on an unclaimed brand); everyone else sees the demo.
     A server with no sign-in (local) has nobody to tell apart, so it stays open */
  const a = await auth.accessOf(slug, me), member = !!a.role;
  const dev = !process.env.K_SERVICE && String(me?.sub || '').startsWith('dev'); /* a local dev sign-in (/auth/dev) is judged like a real one */
  const v = { member, claimed: a.claimed, eligible: a.eligible, gen: a.gen || (!auth.signinOn() && !dev), host: a.host || null, email: me?.email || null, name: me?.name || null, pic: me?.pic || null, seats: member ? a.seats : null }; MEMO.set(k, { at: Date.now(), v }); if (MEMO.size > 5000) MEMO.clear(); visSeen(slug, me, v, a); return v; };
/* fresh work (AI text, images, video, voice, rewrites) for this brand: the gate every generation route asks. With no brand
   open (the Brew default context), only SquareUp's people make new work */
const genOk = async (req, slug) => { const dev = !process.env.K_SERVICE && String(auth.user(req)?.sub || '').startsWith('dev');
  if (process.env.DEMO_MODE === '1' || ((!auth.signinOn() || (process.env.DEV_MEMBER === '1' && !process.env.K_SERVICE)) && !dev)) return true;
  if (!slug || slug === DEFAULT) return auth.isAdmin(auth.user(req)); return !!(await viewerOf(req, slug)).gen; };
/* the gate's words: 'Demo mode' only on the demo site; on live the person is told how to get in */
const demoErr = (host) => ({ error: DEMO ? `Demo mode: sign in with your work email${host ? ` at ${host}` : ''} to make this.` : `Sign in with your work email${host ? ` at ${host}` : ''}, or ask the owner for an invite.`, demo: true, host: host || null });
let connectors = null;
/* real connected accounts on the live site (read only, tokens in the vault; Slack posts what the team sends); DUMMY: simulated on the demo site (connectors/index.js simOnly) */
connectors = createConnectors({ packs, auth, builder, treg, log: console, onLive: (slug) => { MEMO.clear(); feedSvc?.refreshLive(slug).catch(() => {}); } });
const slackRoutes = DEMO ? null : createSlackRoutes({ connectors, feed: () => feedSvc, log: console });
/* Brew inside the Shopify admin: the public app's install, session tokens, webhooks (shopify-app.js); live site only */
const shopifyApp = DEMO ? null : createShopifyApp({ auth, connectors, builder, packs, log: console });
/* a shared jam link: anyone can look; signing in makes a person a guest of that one jam (feed-service guestOk), never a
   member of the brand's team. Team access comes only from an owner's invite or the brand's work email (auth.js) */
feedSvc = createFeedService({ ai, /* Drop anything here reads PDFs and photos with it (drop-read.js) */ /* tagging an email in a jam invites them to the team, with the tagger's own views (any teammate may invite to their views) */
  inviteTo: async (slug, by, email) => { const role = await auth.roleOf(slug, by); if (!role) return { error: 'Only the team invites people.' }; const seats = role === 'owner' || role === 'admin' ? 'all' : (await auth.seatsOf(slug, by)) ?? 'all';
    return auth.invite(slug, by, email, seats, process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', true); }, liveTeamOnly: () => auth.signinOn() && process.env.DEMO_MODE !== '1', clientIp, jamMail, memory: MEMORY_ON() ? memory : null, isStaff: (email) => auth.isAdmin({ email }), teamOf: (slug) => auth.getMembers(slug), onOpen: (slug) => { social.opened(slug); draftsBg.opened(slug); builder.heal?.(slug).then((ch) => { if (ch?.length) { packs.drop(slug); loadBrand(slug).catch(() => {}); } }).catch(() => {}); }, PUB, claudeJSON,  finals, sloosh, budgetLeft: (slug) => budget.left(slug).credits, globalPacks: packs, claudeTool, cardBrief, mockVariants, geminiImage: imageGen, treg, launchBrowser, zipBuffer, photoAsync, isMock: () => MOCK, spend, BANNED, clean, store, packs: brandPacks, builder, photoFile, learnings,
  /* Demo Mode: a tour session reads the store live while the visitor watches (demo-routes.js session flow) */
  liveReadFor: DEMO ? async (slug) => (await packs.getJSON(slug, 'private/demo/session.json', null))?.flow === 'onboarding' : null,
  /* one count of the moves written (QA FEED-QA-09): on the demo site a tour session replays the build, and the feed's "Your moves"
     line reads the same replay as the status route (demo-routes.js simStatus); the session is read in the background */
  viewStatus: DEMO ? (slug, st) => { const k = `${demoSid() || ''}|${slug}`; /* each visitor's own tour session (demo-mode.js sandboxes the file per visitor) */
    if (!DEMO_SES.has(k)) packs.getJSON(slug, 'private/demo/session.json', null).then((x) => { if (!DEMO_SES.has(k)) demoSes(slug, x); }).catch(() => {}); return simStatus(st, DEMO_SES.get(k)); } : null, /* demo-routes keeps the copy fresh on every read and write (onSession) */
  closedFor: (req, res, u, slug) => closedGate.closedFor(req, res, u, slug), /* a workspace, card or jam of a store not open yet: its team only */
  slack: DEMO ? null : connectors, /* a really connected Slack: jams post to it and its thread replies come back (slack-routes.js) */
  viewerOf, genOk, liveFor: (slug, member) => connectors.forViewer(slug, member),
  /* membership checked from the signed-in user on every request and on the background clock (feed-service.js REQ / bgTeam) */
  isMemberEmail: (slug, email) => auth.isMember(slug, { email: String(email || '').toLowerCase() }), roleOf: (slug, email) => auth.roleOf(slug, { email: String(email || '').toLowerCase() }) });
feedSvc.wire(B());
retireInit.finally(() => { if (!process.env.BUILD_RESUME_OFF) builder.resumeAll().catch((e) => console.error('[build] resumeAll', e.message)); });
retireInit.finally(() => { if (!process.env.BUILD_RESUME_OFF) finals.reconcileAll().then((n) => { if (n) console.log(`[finals] ${n} run(s) picked up after the restart`); }).catch((e) => console.error('[finals] reconcileAll', e.message)); }); // resume off for a local server reading the live bucket

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
    /* a new brand is read only for its own people (Param, 23 Oct): a Gmail or another company's email would spend a read (~$6)
       on a brand it can never open, so it is pointed at the demo stores. A brand already read just opens (its page has the wall) */
    if (me && auth.signinOn() && !DEMO && !auth.isAdmin(me)) { const host = String(b.url || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/^www\./i, '').toLowerCase(), sl = slugOf(String(b.url || '').trim());
      if (host && sl && !officialFor(me.email, host) && !(await packs.getJSON(sl, 'status.json', null).catch(() => null))) return send(res, 200, { error: `Brew reads a brand for its own team. Sign in with your work email at ${host} to read it.`, demoStores: true, host }), true; }
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
    const [th, tr, cm, st, it, lc, pf] = await Promise.all([g('listen/themes.json'), g('listen/threads.json'), g('listen/communities.json'), g('listen/status.json'), g('listen/items.json'), g('listen/config.json'), g('profile.json')]);
    const v = heardView({ themes: th?.themes || [], total: th?.total || 0, threads: tr?.threads || [], communities: cm?.communities || [], status: st, items: it?.items || [], config: lc }, { name: packs.peek(slug)?.name || (await packs.getJSON(slug, 'status.json', {}))?.name || slug, profile: pf || {} });
    const bg = await social.due(slug).catch(() => null), ss = await social.stateOf(slug).catch(() => ({}));
    /* lastListen is when a run FINISHED: a run that started and was cut off by a restart is not "heard" (social-feed.js dueFor) */
    const ls = ss.listen || {}, running = ls.state === 'running' && !ls.killed;
    return send(res, 200, { heard: v, schedule: { lastListen: ls.at || ls.last?.at || null, listening: running, interrupted: ls.state === 'running' && !!ls.killed, error: ls.error || null, lastIdeas: ss.lastIdeas || null, spentToday: ss.spend || null, due: bg } }), true; }
  // What Brew watches for you: listening, shelves and marketplaces, rivals and AI answers in four blocks (watch-view.js)
  const wm = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/watch$/);
  if (wm && req.method === 'GET') { const slug = wm[1]; if (blocked(slug)) return send(res, 404, { error: 'unknown brand' }), true;
    const g = (n) => packs.getJSON(slug, n, null).catch(() => null);
    const [pf, it, th, st, pl, tf, ...sh] = await Promise.all([g('profile.json'), g('listen/items.json'), g('listen/themes.json'), g('listen/status.json'), g('pulse/latest.json'), g('shelf/traffic.json'), ...SHELF_KEYS.map((k) => g(`shelf/${k}.json`))]);
    const name = pf?.brandName || pf?.name || packs.peek(slug)?.name || slug;
    return send(res, 200, watchView({ name, host: pf?.host || null, profile: pf || {}, listen: { items: it?.items || [], themes: th?.themes || [], status: st || {} }, shelf: Object.fromEntries(SHELF_KEYS.map((k, i) => [k, sh[i]])), pulse: pl, traffic: tf })), true; }
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
  /* who opened which brand (visSeen): newest first; ?slug= one brand, ?blocked=1 only the ones kept out */
  if (req.method === 'GET' && u.pathname === '/api/admin/visitors') { if (!auth.isAdmin(auth.user(req))) return send(res, 403, { error: 'admins only' }), true;
    const slug = u.searchParams.get('slug'), bl = u.searchParams.get('blocked') === '1';
    const rows = Object.values(await visLoad()).filter((r) => (!slug || r.slug === slug) && (!bl || r.access === 'blocked' || r.blocked)).sort((x, y) => y.last - x.last);
    return send(res, 200, { n: rows.length, emails: new Set(rows.map((r) => r.email)).size, rows }), true; }
  if (req.method === 'GET' && u.pathname === '/api/admin/treg') { if (!auth.isAdmin(auth.user(req))) return send(res, 403, { error: 'admins only' }), true;
    const slug = u.searchParams.get('brand'), month = new Date().toISOString().slice(0, 7);
    const [news, spend] = await Promise.all([watchCatalog(treg).catch((e) => ({ error: e.message })), slug ? packs.getJSON(slug, `spend/${month}.json`, null).catch(() => null) : null]);
    return send(res, 200, { news, spend, meter: { usd: treg.meter.usd, calls: treg.meter.calls, today: treg.meter.dayUsd } }), true; }
  /* one name for the team (FEED-QA-10): move docs written before say "the Brew deployment team"; they read the agreed phrase */
  const crewName = (d) => { const j = d && JSON.stringify(d); return j && j.includes('Brew deployment team') ? JSON.parse(j.replace(/\bthe Brew deployment team\b/g, 'the ShopOS team, Brew’s build crew').replace(/\bBrew deployment team\b/g, 'The ShopOS team, Brew’s build crew')) : d; };
  const mm = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/moves\/(\d+)$/);
  if (mm) { const p = await loadBrand(mm[1]), v = await viewerOf(req, mm[1]); const priv0 = v.member ? (await packs.getJSON(mm[1], 'private/moves.json', {}))[+mm[2]] : null, priv = priv0 && connectedOk(priv0.meta, await connectors.connectedIds(mm[1]), +mm[2]) ? priv0 : null; /* a move written from an account since disconnected waits hidden */
    return send(res, 200, crewName(priv ? { ...(p?.fitMove ? p.fitMove(priv) : markMoveClaims(priv, packSource(p))), private: true } : p?.moveDocs?.[+mm[2]] || { error: 'not written yet' })), true; } /* the team's own moves are marked like the shared ones (QA-25); one name for the team */
  /* the fact sheet: anyone may read the public sheet; members also see their connected facts; on a claimed brand only its team edits */
  const fm = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/facts$/);
  if (fm) { const slug = fm[1]; if (blocked(slug) || !(await packs.getJSON(slug, 'status.json', null))) return send(res, 404, { error: 'unknown brand' }), true;
    const fv = await viewerOf(req, slug), canEdit = !!fv.member || (!fv.claimed && !!fv.gen && (!auth.signinOn() || !!fv.email)); // the team, or the brand's own work email before it is claimed
    if (req.method === 'GET') return send(res, 200, await factsDesk.view(slug, { member: fv.member, canEdit })), true;
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true;
    if (!canEdit) return send(res, 403, { error: 'Only this brand’s team can change its facts. Ask them for access.', team: true }), true;
    const b = await readBody(req), r = await factsDesk.edit(slug, b, { by: fv.email || 'the team' });
    if (r?.data) r.data = await factsDesk.view(slug, { member: fv.member, canEdit }); return send(res, r?.error ? 400 : 200, r), true; }
  const m = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/(status|summary|confirm|check|build|retry|pro|events|moves|notify|findings|updates|feed-open)$/); if (!m) return false;
  const [, slug, what] = m;
  // only the team (or an official email on an unclaimed brand, or SquareUp) changes it: confirm, check, rewrite, retry, auto.
  // Everyone else sees the brand in demo mode
  const v = await viewerOf(req, slug);
  if (!v.gen && req.method === 'POST' && what !== 'notify' && !v.email && auth.signinOn() && process.env.BUILD_SIGNIN !== '0') return send(res, 401, { error: 'Sign in with your work email to continue.', signin: true }), true;
  if (!v.gen && req.method === 'POST' && what !== 'notify') return send(res, 403, { ...demoErr(v.host), error: v.claimed ? 'Only this brand’s team changes it. Ask the owner for an invite.' : `Sign in with a work email at ${v.host || 'the brand’s domain'}, or ask the owner for an invite.`, team: true }), true;
  if (what === 'status') { let s = (await builder.status(slug)) || { error: 'unknown brand' };
    /* one count: never fewer written than the moves on file (pack-numbers.js), and a time left only from the measured pace.
       Within one build it never goes down (QA FEED-QA-21: 10 then 9 when the cached pack count fell away): the highest count this
       build has shown is kept, per brand and build (createdAt), capped at the total */
    if (!s.error && !s.done) { const w = +packs.peek(slug)?.numbers?.moves?.written || 0, k = String(s.createdAt || ''), hw = WRITTEN_HW.get(slug), was = hw?.k === k ? hw.n : 0;
      const n = Math.min(Math.max(+s.movesDone || 0, w, was), +s.total || Infinity); WRITTEN_HW.set(slug, { k, n }); if (n !== +s.movesDone) s = { ...s, movesDone: n }; }
    if (!s.error) s = { ...s, etaMin: movesEta(s) };
    /* status stays public (someone signing in mid-read sees where it is), but the move titles, files and spend are the team's */
    if (!(await teamRead(req, slug))) { const { pdfs, zips, statics, usd, proBy, proAt, ...pub } = s; return send(res, 200, pub), true; }
    return send(res, 200, s), true; }
  if (what === 'summary') return send(res, 200, await builder.summary(slug)), true;
  if (what === 'notify' && req.method === 'POST') { const b = await readBody(req), me = auth.user(req);
    /* "email me when the moves are in": a signed-in person adds their own address (the team may add a teammate), so nobody turns Brew into a mailer */
    if (auth.signinOn() && !me) return send(res, 401, { error: 'Sign in to get an email when the moves are in.', signin: true }), true;
    /* the moves-ready box's Mute: a signed-in person turns Brew's emails for this brand off (or back on) for themselves only; the
       same switch the jam emails' footer sets (private/mail-prefs.json), read by the moves emails and the weekly digest */
    if (typeof b.mute === 'boolean') { if (!me) return send(res, 401, { error: 'Sign in first.', signin: true }), true;
      const x = await jamMail.setPref(slug, me.email, { mail: b.mute ? 'off' : 'all' }); return send(res, 200, { ok: true, muted: x.mail === 'off', email: me.email }), true; }
    /* the moves emails name the moves: only for the brand's own people, never someone it keeps out (Param, 23 Oct) */
    if (me && !v.gen) return send(res, 403, { error: 'The moves emails are for the brand’s team. Ask them to invite you.', team: true }), true;
    const want = String(b.email || '').trim().toLowerCase();
    if (me && want !== String(me.email).toLowerCase()) { /* a member may add a teammate or someone already invited; nobody adds a stranger */
      const tm = v.member ? await auth.getMembers(slug).catch(() => null) : null, team = new Set([...(tm?.members || []).map((x) => String(x.email).toLowerCase()), ...(tm?.invites || []).map((x) => String(x.email).toLowerCase())]);
      if (!team.has(want)) return send(res, 403, { error: v.member ? `We can only email you, at ${me.email}, or someone on ${slug}’s team.` : `We can only email you, at ${me.email}.` }), true; }
    return send(res, 200, await builder.addEmail(slug, b.email)), true; }
  if (what === 'findings') return send(res, 200, (await packs.getJSON(slug, 'findings.json', null)) || { cards: [] }), true;
  /* confirming what was read starts the brief and the moves: a signed-in person only, who becomes the brand's creator if nobody is yet */
  /* an official email confirming the read of a brand nobody has claimed takes it: confirming is the moment it becomes theirs */
  const signGate = async () => { if (!auth.signinOn() || process.env.BUILD_SIGNIN === '0') return null; const me = auth.user(req); if (!me) return { error: 'Sign in with Google to continue.', signin: true };
    if (v.eligible && !v.member) { await auth.claim(slug, me, 'Confirmed the read'); MEMO.clear(); }
    if (!(await packs.getJSON(slug, 'private/created.json', null))) await packs.put(slug, 'private/created.json', { by: me.email, at: Date.now(), after: 'read' }).catch(() => {}); return null; };
  if (what === 'confirm' && req.method === 'POST') { const g = await signGate(); if (g) return send(res, 401, g), true; const b = await readBody(req); return send(res, 200, await builder.confirm(slug, b.edits || [], b.v2 || null)), true; }
  /* the first open of the feed after onboarding starts a new brand's moves (build.js feedOpened): the brand's own people only */
  if (what === 'feed-open' && req.method === 'POST') { if (auth.signinOn() && process.env.BUILD_SIGNIN !== '0' && !(auth.user(req) && (v.member || v.eligible))) return send(res, auth.user(req) ? 403 : 401, { error: 'Only the brand’s team starts its moves.' }), true;
    return send(res, 200, await builder.feedOpened(slug)), true; }
  if (what === 'build') return send(res, 200, await builder.buildInfo(slug)), true;
  /* an "Out of date" reason that today's store contradicts (a read that took prices in cents: "$59 is now $5,700") is not shown
     (QA 20 Oct): every price change it names must match the product's price today */
  const staleTrue = (x, p) => { const ch = (x?.changes || []).map((c) => /^(.*) price: .+? → (.+)$/.exec(String(c))); if (!ch.length || ch.some((m) => !m)) return true;
    const num = (t) => { const m = /([\d.,]+)\s*([kKmM])?/.exec(String(t)); if (!m) return NaN; return +m[1].replace(/,/g, '') * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1); };
    return ch.some(([, name, now]) => { const it = (p?.catalog || []).find((y) => y.t === name.trim()); if (!it?.price) return true; const a = num(it.price), b = num(now); return !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) / Math.max(a, 1) <= 0.03; }); };
  if (what === 'updates' && req.method === 'GET') { const u = await builder.updates(slug, { member: !!v.member }); if (Array.isArray(u?.stale)) { const pk = await loadBrand(slug); u.stale = u.stale.filter((x) => staleTrue(x, pk)); } return send(res, 200, u), true; }
  if (what === 'updates' && req.method === 'POST') { const b = await readBody(req); // check | rewrite { moves } | auto { on }
    const r = b.action === 'check' ? await builder.checkUpdates(slug) : b.action === 'rewrite' ? await builder.rewrite(slug, b.moves || []) : b.action === 'auto' ? await builder.setAuto(slug, b.on) : { error: 'unknown action' };
    return send(res, 200, r), true; }
  if (what === 'retry' && req.method === 'POST') return send(res, 200, await builder.retry(slug)), true;
  if (what === 'pro' && req.method === 'POST') { const me = auth.user(req); return send(res, 200, await builder.goPro(slug, { by: me?.email || v.email || null })), true; } // the paused build carries on to every move
  if (what === 'check' && req.method === 'GET') return send(res, 200, await builder.checkData(slug, { heal: !auth.signinOn() || !!auth.user(req), opened: !!auth.user(req) && !!(v.member || v.eligible) })), true; // a paid repair of the saved read only for someone signed in; the team opening it gets the full wait from now (build.js checkOpened)
  if (what === 'check' && req.method === 'POST') { const g = await signGate(); if (g) return send(res, 401, g), true; const b = await readBody(req); return send(res, 200, await builder.applyCheck(slug, b)), true; }
  if (what === 'moves') { const p = await loadBrand(slug); const ids = v.member ? await connectors.connectedIds(slug) : [], pm = v.member ? Object.fromEntries(Object.entries((await packs.getJSON(slug, 'private/moves.json', {})) || {}).filter(([k, x]) => connectedOk(x?.meta, ids, +k))) : {}, ms = { ...(p?.moveDocs || {}), ...Object.fromEntries(Object.entries(pm || {}).map(([k, x]) => [k, p?.fitMove ? p.fitMove(x) : x])) };
    const stale = Object.fromEntries(Object.entries((await packs.getJSON(slug, 'updates.json', null))?.stale || {}).filter(([, x]) => (v.member || !x.private) && staleTrue(x, p))), ppdf = v.member ? await packs.getJSON(slug, 'private/pdfs.json', {}) : {};
    return send(res, 200, { moves: Object.values(ms).sort((a, b) => a.n - b.n).map((x) => ({ n: x.n, group: x.group, skill: x.skill || null, family: x.family || null, kicker: x.kicker, title: x.title, stat: x.stat, statLabel: x.statLabel, gives: x.gives, live: x.live, verified: !!x.meta?.verified, words: x.meta?.words || null,
      version: x.meta?.version || 1, rewrittenAt: x.meta?.rewrittenAt || null, because: x.meta?.because || null, at: x.meta?.at || null, private: !!pm[x.n], past: x.past || null, stale: stale[x.n] ? { why: stale[x.n].why, priority: stale[x.n].priority } : null })), pdfs: { ...((await builder.status(slug))?.pdfs || {}), ...ppdf }, zips: (await builder.status(slug))?.zips || [], status: await builder.status(slug) }), true; }
  if (what === 'events') { // the build, live (server-sent events), replayed from the start
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const off = builder.subscribe(slug, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`)); req.on('close', off); return true; }
  return false;
};
// a generated brand's files: its client seed and facts, assets, PDFs
/* the Brand Book, shared in one tap (brand-kit.js): the read plus the team's edits that aren't private, for anyone with the link and any
   AI tool. A closed store has no kit; a book not written yet is written on the first visit (free chapters at once, the rest after) */
const brandKit = createBrandKit({ packs, log: console });
const BOOK_RE = /^\/([a-z0-9-]+)\/(brand|brand\.md|brand\.json|llms\.txt|brand-kit\.zip|brand\.pdf)$/;
/* the book as a PDF: this server's own share page printed by the shared Chromium (pdf/render.js withBrowser), kept for half an
   hour per version of the book, so a download or a kit never prints twice */
const bookPdfs = new Map();
async function bookPdf(slug, v) {
  const key = `${slug}|${v?.book?.at || ''}|${JSON.stringify(v?.src || {}).length}|${v?.cover?.tagline || ''}`, hit = bookPdfs.get(slug);
  if (hit && hit.key === key && Date.now() - hit.at < 30 * 60e3) return hit.buf;
  const buf = await withBrowser(async (b) => { const page = await b.newPage();
    try { await page.setViewport({ width: 1120, height: 1400 }); await page.emulateMediaType('print');
      await page.goto(`http://127.0.0.1:${PORT}/${slug}/brand?print=1`, { waitUntil: 'networkidle0', timeout: 45e3 }); await page.waitForSelector('.bb-cover', { timeout: 20e3 });
      return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } })); }
    finally { await page.close().catch(() => {}); } });
  bookPdfs.set(slug, { key, buf, at: Date.now() }); if (bookPdfs.size > 50) bookPdfs.delete(bookPdfs.keys().next().value);
  return buf;
}
const bookPublic = async (req, res, u) => {
  const m = u.pathname.match(BOOK_RE); if (!m || req.method !== 'GET') return false;
  const slug = m[1], what = m[2]; if (blocked(slug) || !(await builder.status(slug))) return send(res, 404, notFoundPage(), 'text/html; charset=utf-8'), true;
  const profile = await packs.getJSON(slug, 'profile.json', null).catch(() => null);
  if (!profile?.host || profile.closed) return send(res, 404, notFoundPage(), 'text/html; charset=utf-8'), true;
  if (await builder.book.stale(slug).catch(() => false)) builder.bookAfter(slug);
  const origin = process.env.PUBLIC_URL || `https://${req.headers.host}`, v = await brandKit.viewOf(slug), base = `${origin}/${slug}`;
  const cors = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' };
  if (what === 'brand.md') { res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', ...cors }); res.end(toMarkdown(v, { url: `${base}/brand` })); return true; }
  if (what === 'llms.txt') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', ...cors }); res.end(llmsTxt(v, { base })); return true; }
  if (what === 'brand.json') { const page = u.searchParams.get('page') === '1';
    const body = page ? { book: v, building: await builder.book.stale(slug).catch(() => false), options: { families: (await import('./brand-book-read.js')).REF_FAMILIES }, share: { page: `/${slug}/brand`, md: `/${slug}/brand.md`, json: `/${slug}/brand.json`, llms: `/${slug}/llms.txt`, zip: `/${slug}/brand-kit.zip`, pdf: `/${slug}/brand.pdf` } } : toJSON(v, { origin });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...cors }); res.end(JSON.stringify(body, null, page ? 0 : 2)); return true; }
  if (what === 'brand.pdf') { const pdf = await bookPdf(slug, v).catch((e) => (console.warn('[book] pdf', slug, e.message), null)); if (!pdf) return send(res, 503, 'The PDF couldn’t be made just now. Try again in a minute.', 'text/plain'), true;
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${String(v.cover?.name || slug).replace(/[^\w .-]+/g, '')} brand book.pdf"`, 'cache-control': 'no-cache' }); res.end(pdf); return true; }
  if (what === 'brand-kit.zip') { const z = await brandKit.zip(slug, { origin, pdf: () => bookPdf(slug, v) }); if (!z) return send(res, 404, 'no', 'text/plain'), true;
    res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${z.name}"`, 'cache-control': 'no-cache' }); res.end(z.buf); return true; }
  const name = String(v.cover?.name || v.name || profile.name || slug).replace(/[<>"]/g, '');
  const html = versioned(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} brand book</title>
<meta name="description" content="${name}'s brand book: voice, words, look, colours, type and its own best work. Free to use with any AI tool.">
<link rel="icon" href="/assets/brew-mark.svg"><link rel="alternate" type="text/markdown" href="/${slug}/brand.md"><link rel="stylesheet" href="feed-system.css"><link rel="stylesheet" href="brand-book.css">
<style>body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font)}</style></head><body><div id="bbk" class="bb"></div>
<script src="loader.js"></script><script src="brand-book.js"></script><script>fetch('/${slug}/brand.json?page=1').then(function(r){return r.json()}).then(function(d){window.BrandBook.render(document.getElementById('bbk'),{slug:'${slug}',readOnly:true,print:/print=1/.test(location.search),data:d,toast:function(m){var t=document.createElement('div');t.className='bb-note';t.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99';t.textContent=m;document.body.appendChild(t);setTimeout(function(){t.remove()},2600)}})})</script></body></html>`).replace('<head>', '<head><base href="/">');
  send(res, 200, html, 'text/html; charset=utf-8'); return true;
};
const brandFiles = async (req, res, u) => {
  const m = u.pathname.match(/^\/b\/([a-z0-9-]+)\/(seed\.js|facts\.js|a\/[\w.-]+|refs\/[\w.-]+|statics\/[\w.-]+|team\/statics\/[\w.-]+|pdf\/[^/]+)$/); if (!m) return false;
  const slug = m[1], what = decodeURIComponent(m[2]);
  /* the team's static ads (private/statics/, made from their private Move 21): signed-in members only, never cached by a proxy */
  if (what.startsWith('team/statics/')) return teamStatic(req, res, slug, what.slice(13), { viewerOf, signedIn: (r) => !!auth.user(r), packs, send });
  if (what === 'seed.js' || what === 'facts.js') { let p = await loadBrand(slug, { fresh: true, share: true }); if (!p) return send(res, 404, '/* unknown brand */', 'text/javascript'), true;
    /* outside the team on live: the brand's name, mark and look only (the sign-in page needs them), no cards, moves or facts */
    if (!(await teamRead(req, slug))) p = { ...p, seed: { ...p.seed, posts: [], scrape: [], steps: [] }, rawSeed: p.rawSeed ? { ...p.rawSeed, posts: [], scrape: [], steps: [] } : undefined, fx: {}, facts: {}, moveDocs: {}, labels: {}, pages: {}, pools: {}, statics: [], staticText: {}, notes: {}, learned: null };
    /* the same pack makes the same script: its ETag lets a reload skip the download (still read fresh, so never stale) */
    const body = what === 'seed.js' ? packs.clientSeed(p) : packs.clientFacts(p), etag = `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag, 'cache-control': 'no-cache' }); res.end(); return true; }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', etag }); res.end(body); return true; }
  if (what.startsWith('statics/')) { const b = await packs.get(slug, what); if (!b) return send(res, 404, 'no', 'text/plain'), true; res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=300' }); res.end(b); return true; }
  if (what.startsWith('a/')) { let f = await packs.assetFile(slug, what.slice(2)); if (!f) return send(res, 404, 'no', 'text/plain'), true;
    /* a saved svg logo that draws nothing (a sprite reference saved alone): the brand's site icon instead, healed on read (QA 20 Oct) */
    if (/\.svg$/i.test(what) && !drawableSvg(await fs.promises.readFile(f, 'utf8').catch(() => ''))) { const p0 = await loadBrand(slug).catch(() => null), mk = String(p0?.seed?.brand?.mark || p0?.profile?.identity?.mark || '').match(/\/a\/([\w.-]+)$/)?.[1]; const g = mk && !/\.svg$/i.test(mk) ? await packs.assetFile(slug, mk) : null; if (g) f = g; }
    return serveFile(req, res, f), true; }
  if (/^refs\/[a-f0-9]{16}\.(png|jpg|webp|mp4)$/.test(what)) { const b = await packs.get(slug, what); if (!b) return send(res, 404, 'no', 'text/plain'), true; res.writeHead(200, { 'content-type': { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4' }[what.split('.').pop()], 'cache-control': 'public, max-age=31536000, immutable' }); res.end(b); return true; } /* References (references.js): hash-named, so forever cacheable */
  /* a brand's PDFs (named or drawn on download) are for its team on live */
  if (!(await teamRead(req, slug))) return send(res, auth.user(req) ? 403 : 401, 'These moves are for the brand’s team. Sign in or ask them to invite you.', 'text/plain'), true;
  /* /b/<slug>/pdf/move-<n>.pdf: the move's PDF, drawn on this first download and kept until the move changes */
  const mn = what.slice(4).match(/^move-(\d{1,4})\.pdf$/i);
  if (mn) { const v = await viewerOf(req, slug); let pp = v.member ? (await packs.getJSON(slug, 'private/pdfs.json', null))?.[+mn[1]] : null, pb = pp ? await packs.get(slug, 'private/pdf/' + pp) : null;
    /* a team-only move with no PDF yet (a weekly private run) is drawn now from the team's copy, never the shared one */
    const pmv0 = v.member && !pb ? (await packs.getJSON(slug, 'private/moves.json', {}).catch(() => ({})))?.[+mn[1]] : null, pk0 = pmv0 ? await loadBrand(slug).catch(() => null) : null, pmv = pmv0 ? (pk0?.fitMove ? pk0.fitMove(pmv0) : markMoveClaims(pmv0, packSource(pk0))) : null;
    if (pmv) { try { await builder.pdfFor(slug, pmv, { priv: true }); pp = (await packs.getJSON(slug, 'private/pdfs.json', null))?.[+mn[1]]; pb = pp ? await packs.get(slug, 'private/pdf/' + pp) : null; } catch (e) { console.warn('[pdf] private', slug, mn[1], e.message); }
      if (!pb) return send(res, 503, 'The PDF could not be drawn just now. Try again in a minute.', 'text/plain'), true; }
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

const demoRoutes = DEMO ? createDemoRoutes({ packs, builder, auth, connectors, readBody, send, loadBrand, social, draftsBg, onSession: (slug, s) => demoSes(slug, s), log: console }) : null;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  zipRes(req, res);
  res.once('finish', () => alerts.response(res.statusCode)); /* the 5xx rate for the ops alerts */
  retire.claim(); // traffic reaches this revision: it is the live one
  if (DEMO) { const ses = sessionOf(req, u); if (ses.set) res.setHeader('set-cookie', ses.set); return runDemo(ses.sid, () => serve(req, res, u)); }
  return serve(req, res, u);
}).listen(PORT, () => console.log(`Brew Feed on http://localhost:${PORT} · AI ${MOCK ? "mock" : `live (${PROVIDER})`} · env ${fs.existsSync(envFile) ? envFile : 'none'}${DEMO ? ' · DEMO MODE' : ''}`));
/* Cloud Run stops an instance with SIGTERM (deploys, scale to zero): the team's jams, any workspace still inside its 1.5 s
   save debounce, the day's budget counters, the treg spend ledger and the batched jam emails are written (or sent) before it
   goes, and the listener closes so in-flight requests finish, all inside 6 s */
process.once('SIGTERM', () => { builder?.stop?.(); /* no new move starts here; the next instance resumes the build */
  movesCadence?.stop?.(); /* the weekly families end before the next one; the next instance carries on */
  const closed = new Promise((r) => { try { server.close(() => r()); server.closeIdleConnections?.(); } catch { r(); } }); /* in-flight requests finish; idle keep-alives go now */
  const work = Promise.allSettled([feedSvc?.jams?.flush?.(), feedSvc?.jam2?.flush?.(), store.flushPending(), budget.flush(), tregLedger.flush(), apifyLedger.flush(), visFlush(), jamMail.drain(), closed]);
  Promise.race([work, new Promise((r) => setTimeout(r, 6000))]).finally(() => process.exit(0)); });
async function serve(req, res, u) {
  try {
    if (demoRoutes && await demoRoutes(req, res, u)) return;
    if (shopifyApp) { await shopifyApp.attach(req, u); if (await shopifyApp.handle(req, res, u)) return; } // a request from inside the Shopify admin carries a session token, not a cookie
    if (await auth.handle(req, res, u)) return;
    if (await closedGate.gate(req, res, u)) return; // a store not open yet: its team only (pages, /b files, brand routes, x-brand calls)
    if (await slooshHandle(req, res, u)) return;
    if (await jamMail.handle(req, res, u)) return; // the mute / only-tags links in jam emails
    if (slackRoutes && await slackRoutes(req, res, u)) return; // what Slack sends: thread replies, Approve (signed)
    if (await connectors.handle(req, res, u)) return;
    if (await teamGate(req, res, u)) return; // live: moves, PDFs, read and stories are for the brand's team
    if (await memoryRoutes(req, res, u)) return; // brand memory
    if (await movesRoutes(req, res, u)) return; // moves on a cadence: refresh, cadence state
    if (await brandRoutes(req, res, u)) return;
    if (await brandFiles(req, res, u)) return;
    if (await bookPublic(req, res, u)) return;
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
    // a page: / is the landing, /<slug> a brand, /privacy and /terms; anything else is a real 404 (legal-pages.js pageOf)
    const pg = pageOf(u.pathname);
    if (pg.kind === 'api') return send(res, 404, { error: 'not found' });
    if (pg.kind !== 'landing' && /\.[a-z0-9]{2,5}$/i.test(u.pathname)) return send(res, 404, 'no', 'text/plain'); /* /index.html is the landing, never a plain "no" (QA 19 Oct) */
    if (pg.kind === 'legal') return send(res, 200, LEGAL[pg.page](), 'text/html; charset=utf-8');
    const html = pg.kind === 'landing' ? await pageFor('') : pg.kind === 'slug' ? await pageFor(pg.slug) : null;
    if (html && pg.redirect) { res.writeHead(302, { location: `/${pg.slug}${u.search}` }); return res.end(); }
    if (html) return send(res, 200, shopifyApp ? shopifyApp.embed(req, u, res, html) : html, 'text/html; charset=utf-8'); /* inside the Shopify admin: App Bridge first */
    return send(res, 404, notFoundPage(), 'text/html; charset=utf-8');
  } catch (e) { console.error(e); send(res, 500, { error: 'server' }); }
}
