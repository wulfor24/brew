// Jam v2 (?v=2): a feed card's button opens here. Chat on the left; on the right, everything the button makes, one tab
// each. Tap any part (a headline, the product, the scene, an area, a slide, a shot, a sentence, a row, a brief section) and a
// small toolbar changes just that part: free changes apply at once, anything a model makes shows its price first. Each piece
// is either made ready to post or turned into a brief for a team; Finish hands over the files, or sends the briefs and
// tracks them. Everything runs on /api/jam2 (jam2/routes.js); v1's jam is never touched.
import { sceneBody, sentencesOf } from './scene.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const srcOf = (s) => (!s ? '' : /^(https?:|data:|blob:|\/)/.test(s) ? s : '/' + s);
const usd = (n) => (n == null ? '' : n < 0.1 ? `$${(+n).toFixed(2)}` : `$${(+n).toFixed(2).replace(/\.00$/, '')}`);
const NARRATORS = ['Kore', 'Puck', 'Aoede', 'Charon'], MOODS = ['warm acoustic', 'upbeat pop', 'calm lo-fi', 'cinematic', 'no music'];
const BRIEF_ONLY = new Set(['creator', 'script', 'shoot', 'act']);
const STATUS = ['sent', 'received', 'in progress', 'delivered'];
const OWNERS = ['ShopOS team', 'Your in-house team', 'A creator', 'Your agency'];
const ADD = [['reel', 'Reel'], ['carousel-ad', 'Carousel'], ['stories', 'Story'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['creator-brief', 'Creator brief'], ['video-script', 'Video script']];

let S = null, api = null, pollT = null;
const fresh = () => ({ jam: null, also: [], tab: 0, sel: null, area: false, box: null, start: null, pend: null, edit: null, pick: null, more: false, hist: false, add: false, fin: false, toast: null, why: false, prices: {}, recipes: {}, slide: 0, shot: 0, err: null, finUrl: null, working: false });

/* ---------- the jam's data ---------- */
const board = () => S.jam?.boards?.[Math.min(S.tab, (S.jam?.boards?.length || 1) - 1)] || null;
const take = (b = board()) => b?.headTake || null;
const recipeOf = (b = board()) => S.recipes[b?.recipe] || { how: ['ai'], sizes: [], kind: b?.kind };
const isBrief = (b = board()) => !!b && (BRIEF_ONLY.has(b.kind) || b.how === 'brief');
const ownBrief = (b = board()) => !!b && BRIEF_ONLY.has(b.kind);
const busyOf = (b = board()) => (b ? S.jam?.busy?.[b.id] || null : null);
const words = (b = board()) => take(b)?.words || {};

/* a reply is used only if the same jam is still open: a late answer for a jam the person left never lands in the next one */
const live = (s0, jid) => S && S === s0 && S.jam?.id === jid;
async function load() { const s0 = S, jid = S.jam.id; const r = await api('GET', `/api/jam2/jams/${jid}`); if (live(s0, jid) && r?.jam && !S.working) { S.jam = r.jam; render(); } }
function poll() { clearInterval(pollT); pollT = setInterval(() => { if (!$('#j2')) return clearInterval(pollT); const wait = S.jam?.boards?.some((b) => (S.jam.busy?.[b.id] && !S.jam.busy[b.id].error) || !b.takes?.length); if (wait && !S.working) load(); }, 2500); }
const toast = (t) => { S.toast = t; render(); clearTimeout(toast.t); toast.t = setTimeout(() => { S.toast = null; render(); }, 5200); };
const say = (from, t, sel = null) => { const s0 = S, jid = S.jam.id; return api('POST', `/api/jam2/jams/${jid}/say`, { from, t, sel }).then((r) => { if (live(s0, jid) && r?.jam) { S.jam = r.jam; render(); } }); };

/* one change on the current board: the reply carries the jam; slow ones come back through the poll */
async function op(body, done = '') {
  const b = board(); if (!b || S.working) return; const s0 = S, jid = S.jam.id; S.working = true; S.pend = null; S.more = false; render();
  const r = await api('POST', `/api/jam2/jams/${jid}/boards/${b.id}/op`, body); if (!live(s0, jid)) return; S.working = false;
  if (r?.jam) S.jam = r.jam; if (r?.error) { toast(r.error); return; }
  /* a slow change comes back later through the poll: its message says so instead of naming a version it isn't yet */
  const bg = !!S.jam.busy?.[b.id] && !S.jam.busy[b.id].error; render(); if (done) say('brew', bg ? `${done}: on it, it lands here as the next version.` : `${done} · v${(take()?.n) || ''}`.replace(/ · v$/, ''));
}
/* a priced step always shows its price before it runs: while prices are still loading it waits for them */
const priced = async (label, cost, run) => { S.more = false; if (!cost || /\$NaN|^\$?$/.test(cost)) { S.pend = { label, cost: 'checking the price…', run: null }; render(); const s0 = S, jid = S.jam.id;
  const p = await api('GET', `/api/jam2/jams/${jid}/prices`); if (!live(s0, jid)) return; if (p?.prices) S.prices = p.prices; S.pend = null; render(); return toast('Prices are in. Tap it again to see what it costs.'); }
  S.pend = { label, cost, run }; render(); };
const ask = (label, val, save) => { S.edit = { label, val: val || '', save }; S.more = false; render(); setTimeout(() => $('#j2-edit')?.focus(), 30); };

/* ---------- what can be selected, and its tools ---------- */
function layerOf(id) { const t = take(); const sc = S.sel?.slide != null ? t?.slides?.[S.sel.slide]?.scene : t?.scene; return sc?.layers?.find((l) => l.id === id) || null; }
function patchLayer(fn, label) { const t = take(), b = board(); const slide = b.kind === 'carousel' ? S.slide : null;
  const sc = JSON.parse(JSON.stringify(slide != null ? t.slides[slide].scene : t.scene)); const l = sc.layers.find((x) => x.id === S.sel.id); if (!l) return; fn(l, sc);
  op(slide != null ? { patch: { slide, slideScene: sc } } : { patch: { scene: sc } }, label); }
function tools() {
  const s = S.sel, b = board(), P = S.prices || {}; if (!s || !b) return null;
  const line = (target, label) => [['Shorter', () => op({ op: 'line', target, ask: 'shorter' }, `${label} shorter`)], ['Warmer', () => op({ op: 'line', target, ask: 'warmer' }, `${label} warmer`)], ['Another way', () => op({ op: 'line', target, ask: 'rewrite' }, `${label} rewritten`)], ['In Hindi', () => op({ op: 'line', target, ask: 'hindi' }, `${label} in Hindi`)]];
  const typeOver = (label, val, save) => ['Type over it', () => ask(label, val, save)];
  if (s.kind === 'text') { const l = layerOf(s.id), role = l?.role || 'headline';
    if (b.kind === 'carousel') return { label: `Slide ${S.slide + 1} · words`, main: [typeOver('Slide words', l?.words, (v) => op({ patch: { slide: S.slide, slideWords: { [role]: v } } }, 'Slide words changed')), ...line({ kind: 'slide', i: S.slide }, 'Slide words').slice(0, 3)], more: [] };
    return { label: role === 'headline' ? 'Headline' : role === 'sub' ? 'Line under it' : 'Words', main: [typeOver('New words', l?.words, (v) => op({ patch: { words: { [role]: v } } }, `${role === 'headline' ? 'Headline' : 'Words'} changed`)), ...line({ kind: 'role', role }, role === 'headline' ? 'Headline' : 'Line').slice(0, 3)],
      more: [line({ kind: 'role', role }, 'Line')[3], ['Bigger', () => patchLayer((x) => { x.style = { ...x.style, size: Math.round((x.style?.size || 48) * 1.12) }; }, 'Words bigger')], ['Smaller', () => patchLayer((x) => { x.style = { ...x.style, size: Math.round((x.style?.size || 48) * 0.88) }; }, 'Words smaller')], ['Hide it', () => patchLayer((x) => { x.hidden = true; }, 'Words hidden')]] }; }
  if (s.kind === 'product') return { label: 'Product · your real photo, locked', main: [['Swap product', () => openPicker()], ['Bigger', () => patchLayer((x) => { const k = 1.12; x.x -= x.w * (k - 1) / 2; x.y -= x.h * (k - 1) / 2; x.w *= k; x.h *= k; }, 'Product bigger')], ['Smaller', () => patchLayer((x) => { const k = 0.88; x.x += x.w * (1 - k) / 2; x.y += x.h * (1 - k) / 2; x.w *= k; x.h *= k; }, 'Product smaller')], ['Blend into the light', () => priced('Blend the product into the scene’s light (the label stays exact)', usd(P.blend), () => op({ op: 'blend' }, 'Blended into the scene')), usd(P.blend)]],
    more: [['Move left', () => patchLayer((x) => { x.x -= x.w * 0.15; }, 'Product moved')], ['Move right', () => patchLayer((x) => { x.x += x.w * 0.15; }, 'Product moved')], ['Move up', () => patchLayer((x) => { x.y -= x.h * 0.12; }, 'Product moved')], ['Move down', () => patchLayer((x) => { x.y += x.h * 0.12; }, 'Product moved')]] };
  if (s.kind === 'logo' || s.kind === 'badge' || s.kind === 'image') return { label: s.kind === 'logo' ? 'Logo' : 'Badge', main: [['Hide it', () => patchLayer((x) => { x.hidden = true; }, `${s.kind} hidden`)], ['Bigger', () => patchLayer((x) => { x.w *= 1.15; x.h *= 1.15; if (x.style?.size) x.style.size *= 1.15; }, `${s.kind} bigger`)], ['Smaller', () => patchLayer((x) => { x.w *= 0.87; x.h *= 0.87; if (x.style?.size) x.style.size *= 0.87; }, `${s.kind} smaller`)]], more: [] };
  if (b.kind === 'carousel' && ['bg', 'whole', 'area'].includes(s.kind)) return { label: `Slide ${S.slide + 1}`, main: [['New words for every slide', () => op({ op: 'redo-words' }, 'New words')], ['Redo the carousel', () => priced(`Redo the carousel: ${take()?.slides?.length || 4} new slides, same idea`, S.prices.redo != null ? usd(S.prices.redo * (take()?.slides?.length || 4)) : '', () => op({ op: 'first' }, 'New carousel'))]], more: [] };
  if (b.kind === 'carousel' && s.kind === 'product') return { label: `Slide ${S.slide + 1} · product`, main: [['Bigger', () => patchLayer((x) => { const k = 1.12; x.x -= x.w * (k - 1) / 2; x.y -= x.h * (k - 1) / 2; x.w *= k; x.h *= k; }, 'Product bigger')], ['Smaller', () => patchLayer((x) => { const k = 0.88; x.x += x.w * (1 - k) / 2; x.y += x.h * (1 - k) / 2; x.w *= k; x.h *= k; }, 'Product smaller')]], more: [] };
  if (s.kind === 'bg') return { label: 'Scene', main: [['New scene', () => ask('What scene? (or leave it to Brew)', '', (v) => priced('A new scene behind the product, same words', usd(P.background), () => op({ op: 'background', ask: v }, 'New scene'))), usd(P.background)], ['Change an area', () => { S.area = true; S.sel = null; render(); }]], more: [] };
  if (s.kind === 'whole') return { label: `${b.label} · whole picture`, main: [['Redo it', () => priced('One new take: a new scene, same words and product', usd(P.redo), () => op({ op: 'redo' }, 'New take')), usd(P.redo)], ['New words', () => op({ op: 'redo-words' }, 'New words')], ['Make the final', () => priced('Make the final: premium finish, same layout and words', P.final != null ? usd(P.final) : P.finalCredits ? `${P.finalCredits} credits` : 'priced first', () => op({ op: 'final' }, 'Final made')), P.final != null ? usd(P.final) : P.finalCredits ? `${P.finalCredits} credits` : '']],
    more: [['Make it a reel', () => addBoard('reel')], ['Make it a carousel', () => addBoard('carousel-ad')], ['Brief a team instead', () => setMode('brief')]] };
  if (s.kind === 'area') return { label: 'Selected area', main: [], more: [] };
  if (s.kind === 'shot') { const sh = take()?.timeline?.shots?.[s.i] || {}; const set = (f) => (v) => { const tl = JSON.parse(JSON.stringify(take().timeline)); tl.shots[s.i][f] = v; op({ patch: { timeline: tl } }, `Shot ${s.i + 1} changed`); };
    return { label: `Shot ${s.i + 1}`, main: [['What we see', () => ask('What we see in this shot', sh.see, set('see'))], ['Voiceover', () => ask('What the voice says', sh.vo, set('vo'))], ['On-screen words', () => ask('Words on screen', sh.words, set('words'))], ['Voiceover shorter', () => op({ op: 'line', target: { kind: 'shot', i: s.i, field: 'vo' }, ask: 'shorter' }, `Shot ${s.i + 1} voiceover shorter`)]],
      more: [['Longer (+1 s)', () => { const tl = JSON.parse(JSON.stringify(take().timeline)); tl.shots[s.i].sec = Math.min(10, (tl.shots[s.i].sec || 4) + 1); op({ patch: { timeline: tl } }, `Shot ${s.i + 1} longer`); }], ['Shorter (−1 s)', () => { const tl = JSON.parse(JSON.stringify(take().timeline)); tl.shots[s.i].sec = Math.max(2, (tl.shots[s.i].sec || 4) - 1); op({ patch: { timeline: tl } }, `Shot ${s.i + 1} shorter`); }], ['Remove this shot', () => { const tl = JSON.parse(JSON.stringify(take().timeline)); tl.shots.splice(s.i, 1); S.sel = null; op({ patch: { timeline: tl } }, 'Shot removed'); }]] }; }
  if (s.kind === 'track') { const tl = () => JSON.parse(JSON.stringify(take().timeline));
    if (s.which === 'voice') return { label: 'Voice', main: NARRATORS.map((n) => [n, () => { const x = tl(); x.voice = n; op({ patch: { timeline: x } }, `Voice: ${n}`); }]), more: [] };
    if (s.which === 'music') return { label: 'Music', main: MOODS.map((m) => [m, () => { const x = tl(); x.music = m; op({ patch: { timeline: x } }, `Music: ${m}`); }]), more: [] };
    return { label: 'Captions', main: [[take()?.timeline?.captions ? 'Turn off' : 'Turn on', () => { const x = tl(); x.captions = !x.captions; op({ patch: { timeline: x } }, `Captions ${x.captions ? 'on' : 'off'}`); }]], more: [] }; }
  if (s.kind === 'sent') { const parts = sentencesOf(words().body); const set = (v) => { parts[s.i * 2] = v; op({ patch: { words: { body: parts.join('') } } }, 'Sentence changed'); };
    return { label: `Sentence ${s.i + 1}`, main: [typeOver('This sentence', parts[s.i * 2], set), ...line({ kind: 'sent', i: s.i }, 'Sentence').slice(0, 3)], more: [line({ kind: 'sent', i: s.i }, 'Sentence')[3], ['Remove it', () => { parts[s.i * 2] = ''; S.sel = null; op({ patch: { words: { body: parts.join('').replace(/ {2,}/g, ' ').trim() } } }, 'Sentence removed'); }]] }; }
  if (s.kind === 'subject') return { label: 'Subject line', main: [typeOver('Subject line', words().subject, (v) => op({ patch: { words: { subject: v } } }, 'Subject changed')), ...line({ kind: 'subject' }, 'Subject').slice(0, 3)], more: [] };
  if (s.kind === 'block') { const bl = words().blocks?.[s.i] || {}; return { label: bl.title || 'Section', main: [typeOver(bl.title || 'Section', bl.text, (v) => { const bs = JSON.parse(JSON.stringify(words().blocks)); bs[s.i].text = v; op({ patch: { words: { blocks: bs } } }, `${bl.title || 'Section'} changed`); }), ['Shorter', () => op({ op: 'line', target: { kind: 'block', i: s.i }, ask: 'shorter' }, `${bl.title} shorter`)], ['Another way', () => op({ op: 'line', target: { kind: 'block', i: s.i }, ask: 'rewrite' }, `${bl.title} rewritten`)]], more: [] }; }
  if (s.kind === 'row') { const rw = words().rows?.[s.i] || {}; const rows = () => JSON.parse(JSON.stringify(words().rows || []));
    return { label: `Row ${s.i + 1}`, main: [['Change it', () => ask(`${(words().cols || [])[1] || 'Value'} for ${rw.a}`, rw.b, (v) => { const r = rows(); r[s.i].b = v; op({ patch: { words: { rows: r } } }, `Row ${s.i + 1} changed`); })], ['Change the action', () => ask(`${(words().cols || [])[2] || 'Change'} for ${rw.a}`, rw.c, (v) => { const r = rows(); r[s.i].c = v; op({ patch: { words: { rows: r } } }, `Row ${s.i + 1} changed`); })], ['Remove', () => { const r = rows(); r.splice(s.i, 1); S.sel = null; op({ patch: { words: { rows: r } } }, 'Row removed'); }]],
      more: [['Add a row', () => ask('New row: what, where, change (separate with commas)', '', (v) => { const [a, bb, c] = v.split(',').map((x) => x.trim()); const r = rows(); r.push({ a: a || v, b: bb || '', c: c || '' }); op({ patch: { words: { rows: r } } }, 'Row added'); })]] }; }
  if (s.kind === 'brief') { const bv = b.briefView?.[s.i] || {}; return { label: `Brief · ${bv.h || ''}`, main: [typeOver(bv.h, bv.t, (v) => brief({ edit: { i: s.i, t: v } }, `${bv.h} changed`)), ...(bv.h === 'Who and when' ? [['Who makes it', () => { S.pick = { owners: true }; render(); }], ['Due date', () => ask('Due (e.g. Fri 25 Oct)', b.brief?.due || '', (v) => brief({ due: v }, `Due ${v}`))]] : [])], more: [] }; }
  return null;
}

/* ---------- actions ---------- */
async function brief(body, done = '', bid = board()?.id) { const s0 = S, jid = S.jam.id; const r = await api('POST', `/api/jam2/jams/${jid}/boards/${bid}/brief`, body); if (!live(s0, jid)) return null; if (r?.jam) S.jam = r.jam; if (r?.error) return toast(r.error); render(); if (done) say('brew', done); return r; }
async function setMode(m) { S.sel = null; await brief({ mode: m }); toast(m === 'brief' ? 'Now a brief for a team: the words are locked as final, with specs, references, who and when. Tap any part to change it.' : 'Back to making it here, ready to post.'); }
/* boards are found by id: the jam object is replaced after every reply */
async function sendBrief(b = board()) { const r = await brief({ send: true, mode: ownBrief(b) ? undefined : 'brief' }, '', b.id);
  if (r?.url) { const nb = r.jam.boards.find((x) => x.id === b.id); S.finUrl = { ...(S.finUrl || {}), brief: location.origin + r.url }; say('brew', `Brief for ${b.label} sent to ${nb?.brief?.owner || OWNERS[0]}. They open it at ${location.origin + r.url} and mark it received, in progress, delivered; you see each step here.`); } }
async function addBoard(recipe, label = null) { S.add = false; S.more = false; const s0 = S, jid = S.jam.id; const r = await api('POST', `/api/jam2/jams/${jid}/boards`, { recipe, label }); if (!live(s0, jid)) return; if (r?.error) return toast(r.error); S.jam = r.jam; S.tab = S.jam.boards.length - 1; S.sel = null; render(); say('brew', `Making ${(S.recipes[recipe]?.label || recipe).toLowerCase()} on the same idea.`); }
async function openPicker() { const r = await api('GET', '/api/jam2/products'); S.pick = { products: (r?.products || []).slice(0, 12) }; render(); }
async function render2(confirmUsd) { const b = board(); if (S.working) return; const s0 = S, jid = S.jam.id; S.working = true; render(); const r = await api('POST', `/api/jam2/jams/${jid}/boards/${b.id}/render`, confirmUsd != null ? { confirmUsd } : {}); if (!live(s0, jid)) return; S.working = false;
  if (r?.error) return toast(r.error); if (r?.needsConfirm) return priced(`Render the ${r.quote.seconds} s video: ${(take()?.timeline?.shots || []).length} shots, voice and captions${r.quote.provider ? ` (${r.quote.provider})` : ''}`, r.quote.usd != null ? usd(r.quote.usd) : `${r.quote.credits} credits`, () => render2(r.quote.usd));
  if (r?.jam) S.jam = r.jam; render(); say('brew', 'Rendering the video. It lands here as the next version; you can keep working.'); }
function redo() { const b = board(); if (b.kind === 'carousel' && take()?.slides?.length) return priced(`Redo the carousel: ${take().slides.length} new slides, same idea`, S.prices.redo != null ? usd(S.prices.redo * take().slides.length) : '', () => op({ op: 'first' }, 'New carousel')); if (isBrief(b) && !ownBrief(b)) return op({ op: 'redo-words' }, 'New words'); if (take()?.scene) return priced('Redo it: one new take, a new scene with the same words and product', usd(S.prices.redo), () => op({ op: 'redo' }, 'New take')); op({ op: 'redo-words' }, 'New take'); }

/* Finish: check every piece; made pieces get one ready-to-post link, briefs go to their team */
async function finish() {
  S.fin = true; S.sel = null; render();
}
async function readyLink() { const made = S.jam.boards.filter((b) => !isBrief(b) && take(b)); for (const b of made) if (!b.approved && take(b)?.gate?.pass !== false) await api('POST', `/api/jam2/jams/${S.jam.id}/boards/${b.id}/approve`, {});
  const r = await api('POST', `/api/jam2/jams/${S.jam.id}/ready`, {}); if (r?.error) return toast(r.error); S.jam = r.jam; S.finUrl = { ...(S.finUrl || {}), post: location.origin + r.url }; try { await navigator.clipboard.writeText(location.origin + r.url); } catch {} render(); say('brew', `Ready to post: ${location.origin + r.url} (copied). Every size, the files and the captions to copy. Brew never posts for you.`); }

/* ---------- chat ---------- */
async function send(text) {
  const t = String(text || '').trim(); if (!t) return; const b = board(), s = S.sel; $('#j2-in') && ($('#j2-in').value = '');
  await say('you', t, s ? selName() : null); const low = t.toLowerCase(), c = S.jam.concept || {};
  if (t[0] === '@') return say('brew', 'Saved in this jam for the team: everyone on it sees the thread.');
  if (/\?$/.test(t)) return say('brew', [c.spark?.title && `From the card: ${c.spark.title}.`, c.spark?.says, ...(c.spark?.why || []), ...(c.proof || []).map((p) => `Proof: ${p.text}`)].filter(Boolean).join('\n') || 'The card didn’t carry more than its title.');
  if (/send( the)? brief/.test(low)) return sendBrief(b);
  if (/brief (a|the|my)? ?(team|agency|creator)|brief it|brief instead/.test(low) && !ownBrief(b)) return setMode('brief');
  if (/make it (myself|here|instead|ready)/.test(low)) return setMode('make');
  if (/\brender\b/.test(low) && b.kind === 'video') return render2();
  const sz = /\b(9:16|story|stories)\b/.test(low) ? 'story' : /\b(1:1|square)\b/.test(low) ? 'ig-square' : /\b(16:9|youtube)\b/.test(low) ? 'youtube' : /\b4:5\b/.test(low) ? 'ig-portrait' : null;
  if (sz && take()?.scene && recipeOf(b).sizes?.includes(sz)) return op({ op: 'resize', patch: { size: sz } }, `Now ${sz.replace('ig-', '')}`);
  const target = !s ? null : s.kind === 'text' ? (b.kind === 'carousel' ? { kind: 'slide', i: S.slide } : { kind: 'role', role: layerOf(s.id)?.role || 'headline' }) : s.kind === 'sent' ? { kind: 'sent', i: s.i } : s.kind === 'subject' ? { kind: 'subject' } : s.kind === 'block' ? { kind: 'block', i: s.i } : s.kind === 'row' ? { kind: 'row', i: s.i, col: 'b' } : s.kind === 'shot' ? { kind: 'shot', i: s.i, field: 'vo' } : null;
  if (target) return op({ op: 'line', target, ask: t }, 'Done');
  if (s?.kind === 'bg') return priced(`A new scene: “${t}”`, usd(S.prices.background), () => op({ op: 'background', ask: t }, 'New scene'));
  if (s?.kind === 'area' && s.region) return priced(`Change only that area: “${t}”`, usd(S.prices.area), () => op({ op: 'background', target: 'bg', region: s.region, ask: t }, 'Area changed'));
  if (s?.kind === 'brief') return brief({ edit: { i: s.i, t } }, 'Brief changed');
  return op({ ask: t }, 'Done');
}
const selName = () => { const s = S.sel; if (!s) return ''; return { text: 'Words', product: 'Product', bg: 'Scene', whole: 'Whole picture', area: 'Area', shot: `Shot ${s.i + 1}`, track: s.which, sent: `Sentence ${s.i + 1}`, subject: 'Subject', block: words().blocks?.[s.i]?.title || 'Section', row: `Row ${s.i + 1}`, brief: board()?.briefView?.[s.i]?.h || 'Brief', logo: 'Logo', badge: 'Badge' }[s.kind] || s.kind; };
function chips() {
  const b = board(), s = S.sel; if (!b) return [];
  if (s?.kind === 'text') return ['Shorter', 'Warmer', 'In Hindi'];
  if (s?.kind === 'sent' || s?.kind === 'block') return ['Shorter', 'Friendlier', 'Say it another way'];
  if (s?.kind === 'shot') return ['Make the voiceover warmer', 'Shorter'];
  if (s?.kind === 'brief') return ['Send brief', 'Give it to your agency'];
  if (isBrief(b)) return ['Send brief', 'Make it myself instead', 'Why this?'];
  if (b.kind === 'video') return ['Render it', 'Brief a team instead', 'Why this?'];
  if (take(b)?.scene) return ['Make the headline shorter', 'Show me 9:16', 'Brief a team instead', 'Why this?'];
  if (b.kind === 'table') return ['Brief a team instead', 'Why this?'];
  return ['Shorter', 'Friendlier', 'Why this?'];
}
const chipSay = (c) => { if (c === 'Give it to your agency') return brief({ owner: 'Your agency' }, 'Now with your agency'); if (c === 'Make the headline shorter') return op({ op: 'line', target: { kind: 'role', role: 'headline' }, ask: 'shorter' }, 'Headline shorter'); return send(c); };

/* ---------- the canvas ---------- */
function sceneArt(sc, file, { slide = null } = {}) {
  const sel = S.sel, selId = sel && ['text', 'product', 'logo', 'badge', 'image'].includes(sel.kind) && (slide == null || sel.slide === slide) ? sel.id : null;
  const body = sceneBody(sc, { srcOf, editable: true }).replace(new RegExp(`(data-id="${(selId || '§none').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}")`), '$1 data-sel="1"');
  return `<div class="j2-art${sel?.kind === 'bg' ? ' bgsel' : ''}${S.area ? ' area' : ''}" data-art data-w="${sc.w}" data-h="${sc.h}">${body}${S.box ? `<div class="j2-box" style="left:${S.box.x * 100}%;top:${S.box.y * 100}%;width:${S.box.w * 100}%;height:${S.box.h * 100}%"></div>` : ''}${busyHtml()}</div>`;
}
const busyHtml = (b = board()) => { const bz = busyOf(b); if (S.working) return '<div class="j2-busy"><brew-load class="spin"></brew-load>Working…</div>'; if (!bz || bz.error) return ''; return `<div class="j2-busy"><brew-load class="spin"></brew-load>${esc({ first: 'Making it…', render: 'Rendering the video…', blend: 'Blending…', background: 'Making the scene…', redo: 'Making a new take…', final: 'Making the final…' }[bz.op] || 'Working…')}</div>`; };
function canvas() {
  const b = board(), t = take(b), bz = busyOf(b); if (!b) return '';
  if (!t && !bz) return `<div class="j2-doc" style="align-items:center;text-align:center;gap:10px"><b>${esc(b.label)} isn’t made yet.</b><span style="color:var(--fg-3);font-size:13px">${b.how === 'brief' || BRIEF_ONLY.has(b.kind) ? 'Brew writes it from the card and your Brand Book.' : ['static', 'carousel'].includes(b.kind) || b.recipe === 'email' ? 'Words first, then the picture with your real product.' : 'Brew writes it from the card, in your voice.'}</span><button class="j2-pri" data-redo-first>Make it</button></div>`;
  if (!t) return bz?.error ? `<div class="j2-doc"><p class="j2-err">${esc(bz.error)}</p><button class="j2-pri" data-redo-first>Try again</button></div>` : `<div class="j2-doc" style="align-items:center;text-align:center;gap:10px"><brew-load class="spin"></brew-load><b>Making ${esc(b.label.toLowerCase())}…</b><span style="color:var(--fg-3);font-size:13px">Words first, then the picture with your real product. About a minute.</span></div>`;
  const err = (bz?.error ? `<p class="j2-err">${esc(bz.error)}</p>` : '') + (b.status === 'stale' ? `<div class="j2-bad" style="margin-top:10px;display:flex;gap:10px;align-items:center">The idea changed since this was made.<button class="j2-chip" data-refresh>Remake it on the new idea</button></div>` : '');
  if (isBrief(b) && !ownBrief(b)) return briefDoc(b, t) + err;
  const w = t.words || {};
  if (b.kind === 'carousel' && t.slides?.length) { const i = Math.min(S.slide, t.slides.length - 1), sl = t.slides[i];
    return `<div class="j2-frame"><button class="j2-flab${S.sel?.kind === 'whole' ? ' on' : ''}" data-whole>${esc(b.label)} · slide ${i + 1} of ${t.slides.length}</button>${sceneArt(sl.scene, sl.file, { slide: i })}<div class="j2-strip">${t.slides.map((x, n) => `<button class="${n === i ? 'on' : ''}" data-slide="${n}" aria-label="Slide ${n + 1}"><img src="${esc(srcOf(x.file))}" alt=""></button>`).join('')}</div>${err}</div>`; }
  if (t.scene && b.kind !== 'message') return `<div class="j2-frame"><button class="j2-flab${S.sel?.kind === 'whole' ? ' on' : ''}" data-whole>${esc(b.label)} · ${esc(S.recipes.__sizes?.[b.size]?.label || b.size || '')}${t.final ? ' · Final' : ''}</button>${sceneArt(t.scene, t.file)}${err}</div>`;
  if (b.kind === 'video') return video(b, t) + err;
  if (b.kind === 'table') return table(w) + err;
  if (b.recipe === 'whatsapp') return `<div class="j2-wa"><div style="text-align:center;font-size:11px;color:#555;margin-bottom:10px">Your business account · approved template</div><div class="j2-bubble">${sents(w.body)}</div></div>${err}`;
  if (b.recipe === 'email') return `<div class="j2-mail"><div class="j2-from">From your brand · to {first_name}</div><div style="padding:12px 18px 2px"><button class="j2-s${S.sel?.kind === 'subject' ? ' sel' : ''}" data-subject style="font-size:18px;font-weight:700">${esc(w.subject || 'Subject')}</button></div>${t.file ? `<div style="padding:8px 18px;position:relative"><img src="${esc(srcOf(t.file))}" alt="" style="width:100%;border-radius:8px;display:block">${busyHtml()}</div>` : ''}<div style="padding:8px 16px 18px;font-size:15px">${sents(w.body)}</div>${w.cta ? `<div style="padding:0 18px 20px"><span style="display:inline-block;background:#1f2d48;color:#fff;border-radius:8px;padding:10px 16px;font-weight:600">${esc(w.cta)}</span></div>` : ''}</div>${err}`;
  if (b.recipe === 'community-post' || b.recipe === 'reply') { const c = S.jam.concept?.spark || {};
    return `<div class="j2-doc"><div class="j2-meta">${esc(c.kind || 'thread')}${/^https?:\/\//.test(c.link || '') ? ` · ${esc(c.link.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}` : ''}</div><h3>${esc(c.title || S.jam.title)}</h3><div class="j2-meta" style="margin-top:8px">Your reply · tap any sentence</div><div style="font-size:15px">${sents(w.body)}</div><div style="margin-top:12px"><button class="j2-chip" data-copyopen>Copy and open the thread</button></div></div>${err}`; }
  if (['creator', 'script', 'shoot', 'act'].includes(b.kind)) return blocksDoc(b, w) + err;
  return `<div class="j2-doc"><div class="j2-meta">${esc(b.label)} · tap any sentence</div>${w.headline && b.kind === 'page' ? `<h3>${esc(w.headline)}</h3>` : ''}<div style="font-size:15px">${sents(w.body || w.caption)}</div>${(w.blocks || []).length ? blocks(w) : ''}</div>${err}`;
}
const sents = (body) => sentencesOf(body).map((p, n) => (n % 2 ? (/\n/.test(p) ? '<br>'.repeat(Math.min(2, (p.match(/\n/g) || []).length)) : ' ') : p ? `<button class="j2-s${S.sel?.kind === 'sent' && S.sel.i === n / 2 ? ' sel' : ''}" data-sent="${n / 2}">${esc(p)}</button>` : '')).join('');
const blocks = (w) => (w.blocks || []).map((x, i) => `<button class="j2-blk${S.sel?.kind === 'block' && S.sel.i === i ? ' sel' : ''}" data-block="${i}"><small>${esc(x.title)}</small>${esc(x.text)}</button>`).join('');
const blocksDoc = (b, w) => `<div class="j2-doc"><div class="j2-meta" style="display:flex;gap:8px;align-items:center"><span style="flex:1">${esc(b.label)} · a brief for the people who make it · tap any section</span>${stChips(b)}</div>${blocks(w)}</div>`;
function table(w) { const cols = w.cols?.length ? w.cols : ['What', 'Where', 'Change'];
  return `<div class="j2-tbl"><div style="padding:12px 16px"><b>${esc(board().label)}</b> <span style="color:var(--fg-3);font-size:12.5px">· tap a row</span></div><div class="j2-th">${cols.map((c) => `<span>${esc(c)}</span>`).join('')}</div>${(w.rows || []).map((r, i) => `<button class="j2-tr${S.sel?.kind === 'row' && S.sel.i === i ? ' sel' : ''}" data-row="${i}"><span>${esc(r.a)}</span><span>${esc(r.b)}</span><b>${esc(r.c)}</b></button>`).join('')}<div class="j2-note">Brew never changes your accounts. Apply it yourself, or give it to someone: the steps are below.</div>${(w.blocks || []).length ? `<div style="padding:4px 8px 10px">${blocks(w)}</div>` : ''}</div>`; }
function video(b, t) { const tl = t.timeline || { shots: [] }, sel = S.sel;
  return `<div class="j2-vid">${t.file && /\.mp4$/.test(t.file) ? `<video src="${esc(srcOf(t.file))}" controls playsinline style="height:min(46vh,420px);border-radius:10px;background:#000"></video>` : ''}
  <div class="j2-shots">${tl.shots.map((s, i) => `<button class="j2-shot${sel?.kind === 'shot' && sel.i === i ? ' sel' : ''}" data-shot="${i}"><div class="j2-pic" style="${s.still ? `background-image:url('${esc(srcOf(s.still))}');background-size:cover` : t.cut ? `background-image:url('${esc(srcOf(t.cut))}')` : ''}"></div><i>${esc(s.sec)} s · ${esc(s.camera || '')}</i>${esc(s.see || '')}${s.vo ? `<i>VO: “${esc(s.vo)}”</i>` : ''}${s.words ? `<i>On screen: ${esc(s.words)}</i>` : ''}</button>`).join('')}</div>
  <div class="j2-tracks"><button class="j2-track${sel?.kind === 'track' && sel.which === 'voice' ? ' sel' : ''}" data-track="voice"><span>Voice</span>${esc(tl.voice || 'Kore')}</button><button class="j2-track${sel?.kind === 'track' && sel.which === 'music' ? ' sel' : ''}" data-track="music"><span>Music</span>${esc(tl.music || 'no music')}</button><button class="j2-track${sel?.kind === 'track' && sel.which === 'caps' ? ' sel' : ''}" data-track="caps"><span>Captions</span>${tl.captions ? 'On, timed to the voice' : 'Off'}</button></div>
  ${!t.file ? `<button class="j2-pri" data-render>Render the video${t.quote?.usd != null ? ` · ≈ ${usd(t.quote.usd)}` : ''}</button>` : ''}${busyHtml()}</div>`; }
const stChips = (b) => (b.brief?.status ? `<span class="j2-st">${STATUS.map((x, n) => `<span class="${n <= STATUS.indexOf(b.brief.status) ? 'on' : ''}">${esc(x)}</span>`).join('')}</span>` : '');
function briefDoc(b, t) { const img = t.file && !/\.mp4$/.test(t.file) ? t.file : t.slides?.[0]?.file || t.timeline?.shots?.find((s) => s.still)?.still || t.cut || null;
  return `<div class="j2-doc" style="flex-direction:row;gap:18px;width:min(720px,100%)"><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><b style="flex:1;font-size:16px">Brief · ${esc(b.label)}</b>${b.brief?.status ? stChips(b) : '<span class="j2-st"><span>Not sent yet</span></span>'}</div>
  ${(b.briefView || []).map((x, i) => `<button class="j2-blk${S.sel?.kind === 'brief' && S.sel.i === i ? ' sel' : ''}" data-brief="${i}"><small>${esc(x.h)}</small>${esc(x.t)}</button>`).join('')}</div>${img ? `<div style="flex:0 0 150px"><img src="${esc(srcOf(img))}" alt="" style="width:150px;border-radius:8px;display:block"><span style="font-size:11.5px;color:var(--fg-3)">Brew’s draft, attached as the reference</span></div>` : ''}</div>`; }

/* ---------- the toolbar, popovers, pill, sheet ---------- */
function floatHtml() {
  const out = [], tb = !S.area && tools();
  if (S.pend) out.push(`<div class="j2-tb" style="padding:8px 8px 8px 14px;gap:10px"><span style="font-size:13px">${esc(S.pend.label)}</span>${S.pend.cost ? `<span class="j2-cost" style="font-size:13px;margin:0">${esc(S.pend.cost)}</span>` : ''}<button data-pend-no>Not now</button>${S.pend.run ? '<button class="j2-pri" data-pend-yes>Make it</button>' : ''}</div>`);
  else if (S.edit) out.push(`<div class="j2-tb" style="padding:6px;gap:6px"><span class="j2-lbl">${esc(S.edit.label)}</span><input id="j2-edit" value="${esc(S.edit.val)}" style="width:min(440px,50vw);border:1px solid var(--line);border-radius:9px"><button class="j2-pri" data-edit-ok>Done</button><button data-edit-no aria-label="Cancel">✕</button></div>`);
  else if (S.sel?.kind === 'area') out.push(`<div class="j2-tb" style="padding:6px 6px 6px 12px;gap:6px"><span class="j2-lbl" style="padding:0">What goes here?</span><input id="j2-area" placeholder="e.g. a eucalyptus sprig in a glass" style="width:280px;border:1px solid var(--line);border-radius:9px"><button class="j2-pri" data-area-go>Make it${S.prices.area != null ? ` · ${usd(S.prices.area)}` : ''}</button><button data-clear aria-label="Cancel">✕</button></div>`);
  else if (tb) { out.push(`<div class="j2-tb"><span class="j2-lbl">${esc(tb.label)}</span>${tb.main.map((x, i) => `<button data-tool="${i}">${esc(x[0])}${x[2] ? `<span class="j2-cost">${esc(x[2])}</span>` : ''}</button>`).join('')}${tb.more.filter(Boolean).length ? '<button data-more aria-label="More tools">⋯</button>' : ''}<input id="j2-desc" placeholder="Describe a change…" aria-label="Describe a change to this part"><button data-clear aria-label="Deselect">✕</button></div>`);
    if (S.more) out.push(`<div class="j2-pop">${tb.more.filter(Boolean).map((x, i) => `<button data-mtool="${i}">${esc(x[0])}${x[2] ? `<span class="j2-cost">${esc(x[2])}</span>` : ''}</button>`).join('')}</div>`); }
  if (S.pick?.products) out.push(`<div class="j2-pop j2-picks">${S.pick.products.length ? S.pick.products.map((p, i) => `<button data-prod="${i}"><img src="${esc(srcOf(p.img))}" alt="">${esc(p.name || '')}</button>`).join('') : '<p style="padding:8px">No product photos in the catalog yet.</p>'}<button data-pick-no>Close</button></div>`);
  if (S.pick?.owners) out.push(`<div class="j2-pop">${OWNERS.map((o) => `<button data-owner="${esc(o)}">${esc(o)}</button>`).join('')}</div>`);
  return `<div class="j2-float">${out.join('')}</div>`;
}
function pillHtml() { const b = board(), t = take(b); if (!b || !t) return '';
  const art = !!t.scene && !isBrief(b) && b.kind !== 'message', sizes = art ? (recipeOf(b).sizes || []) : [];
  return `<div class="j2-pill"><div>${art && b.kind !== 'carousel' ? `<button class="${S.area ? 'on' : ''}" data-area>${S.area ? 'Drag a box…' : 'Select an area'}</button>` : ''}${sizes.length > 1 ? `<span class="j2-sep"></span>${sizes.map((z) => `<button class="${b.size === z ? 'on' : ''}" data-size="${esc(z)}">${esc(S.recipes.__sizes?.[z]?.ratio || z)}</button>`).join('')}<span class="j2-sep"></span>` : ''}<button data-hist>History</button><button data-redo>Redo it</button></div></div>
  ${S.hist ? `<div class="j2-hist j2-pop">${b.takes.slice().reverse().map((x) => `<button data-head="${esc(x.id)}" style="${x.id === t.id ? 'font-weight:700' : ''}">v${x.n} · ${esc(x.op)}${x.cost?.usd ? `<span class="j2-cost">${usd(x.cost.usd)}</span>` : ''}</button>`).join('')}</div>` : ''}`; }
function sheetHtml() { if (!S.fin) return ''; const bs = S.jam.boards;
  const fails = bs.filter((b) => !isBrief(b) && take(b)?.gate && !take(b).gate.pass);
  return `<aside class="j2-sheet"><div style="display:flex;align-items:center"><b style="font-size:16px;flex:1">Finish</b><button class="j2-ghost" data-fin-no aria-label="Close">✕</button></div>
  ${fails.length ? `<div class="j2-bad">${fails.map((b) => `<b>${esc(b.label)}:</b> ${esc(take(b).gate.checks.filter((c) => !c.ok && !c.soft).map((c) => c.why).join(' '))}`).join('<br>')}</div>` : '<div class="j2-ok">Checked: the real product, words set as type, claims only from your store, words inside the safe area. Briefs carry final words, specs, references, who and when.</div>'}
  ${bs.map((b, i) => { const t = take(b), r = recipeOf(b), br = isBrief(b);
    const files = br ? `brief link · ${t?.file ? 'the draft attached' : 'words and steps'}` : t?.scene ? (r.sizes || []).map((z) => S.recipes.__sizes?.[z]?.label || z).join(' · ') : b.kind === 'video' ? (t?.file ? 'the video · captions · the script' : 'not rendered yet') : b.kind === 'table' ? 'the sheet (CSV) and the steps' : 'the text to copy';
    return `<div class="j2-row"><div style="display:flex;gap:8px;align-items:center"><b style="flex:1">${esc(b.label)}</b><span style="font-size:11.5px;color:var(--fg-3)">${br ? `Brief → ${esc(b.brief?.owner || OWNERS[0])}` : b.kind === 'table' ? 'You apply it' : 'Ready to post'}</span></div><div class="j2-files">${esc(files)}</div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${br ? `<button class="j2-chip" data-send="${i}">${b.brief?.status ? 'Send again' : 'Send brief'}</button>${stChips(b)}` : !t ? '<span style="font-size:12px;color:var(--fg-3)">Still being made</span>' : `<span style="font-size:12px;color:${t.gate?.pass === false ? 'var(--bad)' : 'var(--ok)'}">${t.gate?.pass === false ? 'Fix first' : '✓ checked'}</span><button class="j2-ghost" data-totab="${i}">Open</button>`}</div></div>`; }).join('')}
  ${bs.some((b) => !isBrief(b) && take(b)) ? `<button class="j2-pri" data-ready style="border-radius:12px;padding:12px">${S.finUrl?.post ? 'Copy the link again' : 'Get the ready-to-post link'}</button>${S.finUrl?.post ? `<a href="${esc(S.finUrl.post)}" target="_blank" rel="noopener" style="font-size:13px;color:var(--info);word-break:break-all">${esc(S.finUrl.post)}</a>` : ''}` : ''}
  ${S.finUrl?.brief ? `<div style="font-size:12.5px;color:var(--fg-2)">Brief link: <a href="${esc(S.finUrl.brief)}" target="_blank" rel="noopener" style="color:var(--info);word-break:break-all">${esc(S.finUrl.brief)}</a></div>` : ''}
  <label style="font-size:12.5px;color:var(--fg-2);display:flex;flex-direction:column;gap:4px">Posted it? Paste the link and Brew reads how it did.<input id="j2-posted" class="j2-in" placeholder="https://www.instagram.com/p/…" style="padding:9px 12px"></label>
  <div style="font-size:12px;color:var(--fg-3)">Brew never posts or changes your accounts.</div></aside>`; }

/* ---------- the page ---------- */
function render() {
  const root = $('#j2'); if (!root || !S) return; const j = S.jam;
  if (!j) { root.innerHTML = `<div class="j2-chat"><div class="j2-head"><button class="j2-back" data-close>← Feed</button><b>Jam</b></div><div class="j2-log">${S.err ? `<p class="j2-err">${esc(S.err)}</p>` : '<brew-load class="spin"></brew-load>'}</div></div><div class="j2-right"></div>`; return; }
  const b = board(), t = take(b), c = j.concept || {}, log = $('.j2-log', root), keepScroll = log ? log.scrollHeight - log.scrollTop - log.clientHeight < 40 : true;
  const first = j.boards.find((x) => take(x)?.file || take(x)?.slides?.length);
  const nBrief = j.boards.filter((x) => isBrief(x)).length;
  root.innerHTML = `<section class="j2-chat"><div class="j2-head"><button class="j2-back" data-close>← Feed</button><b>Jam · ${esc(j.title)}</b></div>
  <div class="j2-log"><div class="j2-spark"><div><b>From your feed:</b> ${esc(c.spark?.title || j.title)}${c.spark?.says ? ` · ${esc(c.spark.says)}` : ''} <button class="j2-why" data-why>${S.why ? 'Hide' : 'Why this?'}</button></div>
    ${S.why ? `${(c.spark?.why || []).length || (c.proof || []).length ? `<ul>${[...(c.spark?.why || []), ...(c.proof || []).map((p) => p.text)].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<button class="j2-angle" data-angle><b>The idea:</b> ${esc(c.angle || 'tap to set it')}${c.goal ? ` · ${esc(c.goal)}` : ''}</button>` : ''}</div>
    <div class="j2-msg">From “${esc(j.cta || 'this card')}” I’m making <b>${j.boards.map((x) => esc(x.label)).join(' + ')}</b>. Tap any part on the right to change just that, or tell me here. Each piece can be made ready to post, or turned into a brief for a team.</div>
    ${first ? `<button class="j2-made" data-totab="${j.boards.indexOf(first)}"><img src="${esc(srcOf(take(first).file || take(first).slides?.[0]?.file))}" alt=""><div><b>${esc(first.label)} · v${take(first).n}</b><br><span>${take(first).gate?.pass === false ? 'Needs a fix before it’s ready' : '✓ real product · ✓ your type · ✓ only your claims'}</span></div></button>` : ''}
    ${(j.chat || []).map((m) => `<div class="j2-msg${m.from === 'you' ? ' you' : ''}">${m.from === 'you' && m.sel ? `<small>${esc(m.sel)}</small>` : m.from === 'you' && m.name ? `<small>${esc(m.name)}</small>` : ''}${esc(m.t)}</div>`).join('')}</div>
  <div class="j2-foot"><div class="j2-chips">${chips().map((x) => `<button class="j2-chip" data-chip="${esc(x)}">${esc(x)}</button>`).join('')}</div>${S.sel ? `<span class="j2-ctx">Editing: ${esc(selName())}<button data-clear aria-label="Stop editing this part">✕</button></span>` : ''}
    <input id="j2-in" class="j2-in" aria-label="Tell Brew what to make or change" placeholder="${S.sel ? `Tell Brew what to change in the ${esc(selName().toLowerCase())}…` : 'Tell Brew what to make or change. ? asks about the card'}"></div></section>
  <section class="j2-right"><div class="j2-tabs">${j.boards.map((x, i) => `<button class="j2-tab${i === S.tab ? ' on' : ''}" data-tab="${i}">${esc(x.label)}${isBrief(x) ? `<span class="j2-tag">${esc(x.brief?.status || 'Brief')}</span>` : ''}${busyOf(x) && !busyOf(x).error ? ' <brew-load class="spin" style="width:12px;height:12px"></brew-load>' : ''}</button>`).join('')}
    <button class="j2-ghost" data-add aria-label="Add a piece" style="font-size:17px">+</button><span class="j2-gap"></span><button class="j2-pri" data-finish>${nBrief === j.boards.length ? 'Send the briefs' : nBrief ? 'Finish · post + brief' : 'Ready to post'}</button>
    ${S.add ? `<div class="j2-pop" style="position:absolute;left:14px;top:50px">${[...new Set([...(S.also || []), ...ADD.map((x) => x[0])])].slice(0, 8).map((r) => `<button data-addr="${esc(r)}">${esc(ADD.find((x) => x[0] === r)?.[1] || S.recipes[r]?.label || r)}</button>`).join('')}</div>` : ''}</div>
  ${b ? `<div class="j2-sub"><b>${esc(b.label)}</b>${t ? `<span>v${t.n}</span>` : ''}${!ownBrief(b) && recipeOf(b).how?.includes('brief') && recipeOf(b).how.length > 1 ? `<span class="j2-mode"><button class="${!isBrief(b) ? 'on' : ''}" data-mode="make">Make it ready to post</button><button class="${isBrief(b) ? 'on' : ''}" data-mode="brief">Brief a team</button></span>` : ''}<span class="j2-gap"></span><span>${ownBrief(b) ? 'A brief for the people who make it' : isBrief(b) ? 'Your team or partner makes it from this brief' : b.kind === 'table' ? 'You or your team apply it; Brew never changes your accounts' : 'Brew makes it; you post it'}</span>${isBrief(b) ? `<button class="j2-chip" data-send="${S.tab}">${b.brief?.status ? 'Send again' : 'Send brief'}</button>` : ''}</div>` : ''}
  <div class="j2-stage">${floatHtml()}${canvas()}</div>${pillHtml()}${sheetHtml()}
  ${S.toast ? `<div class="j2-toast"><span>${esc(S.toast)}</span><button data-toast-no>Close</button></div>` : ''}</section>`;
  fit(); const lg = $('.j2-log', root); if (lg && keepScroll) lg.scrollTop = lg.scrollHeight;
}
/* the scene is drawn at its real size (1080 px wide…) and scaled to fit the stage */
function fit() { const st = $('#j2 .j2-stage'), art = $('#j2 [data-art]'); if (!st || !art) return; const w = +art.dataset.w, h = +art.dataset.h;
  const maxW = Math.max(200, st.clientWidth - 48), maxH = Math.max(200, st.clientHeight - 170), k = Math.min(maxW / w, maxH / h, 1);
  art.style.width = `${Math.round(w * k)}px`; art.style.height = `${Math.round(h * k)}px`; const sc = $('.j2-scene', art); if (sc) sc.style.transform = `scale(${k})`;
  $('[data-sel]', art)?.classList.add('sel'); }

/* ---------- events ---------- */
function wire(root) {
  root.addEventListener('click', (e) => {
    const t = e.target; const g = (s) => t.closest(s);
    if (g('[data-close]')) return close();
    if (g('[data-toast-no]')) { S.toast = null; return render(); }
    if (g('[data-why]')) { S.why = !S.why; return render(); }
    if (g('[data-angle]')) return ask('The idea, in one line', S.jam.concept?.angle, async (v) => { const r = await api('POST', `/api/jam2/jams/${S.jam.id}/concept`, { angle: v }); if (r?.jam) S.jam = r.jam; render(); if (r?.changed) say('brew', 'The idea changed. Pieces made on the old idea are marked; refresh them from their tab.'); });
    const tab = g('[data-tab]'); if (tab) { S.tab = +tab.dataset.tab; S.sel = null; S.area = false; S.box = null; S.pend = null; S.edit = null; S.hist = false; S.slide = 0; return render(); }
    const tt = g('[data-totab]'); if (tt) { S.tab = +tt.dataset.totab; S.fin = false; S.sel = null; S.area = false; S.box = null; S.pend = null; S.edit = null; S.hist = false; S.slide = 0; S.pick = null; return render(); }
    if (g('[data-add]')) { S.add = !S.add; return render(); }
    const ar = g('[data-addr]'); if (ar) return addBoard(ar.dataset.addr);
    if (g('[data-finish]')) return finish(); if (g('[data-fin-no]')) { S.fin = false; return render(); }
    if (g('[data-ready]')) return readyLink();
    const sd = g('[data-send]'); if (sd) return sendBrief(S.jam.boards[+sd.dataset.send]);
    const md = g('[data-mode]'); if (md) return setMode(md.dataset.mode);
    const ch = g('[data-chip]'); if (ch) return chipSay(ch.dataset.chip);
    if (g('[data-clear]')) { S.sel = null; S.area = false; S.box = null; S.more = false; S.pick = null; return render(); }
    if (g('[data-more]')) { S.more = !S.more; return render(); }
    const tl = g('[data-tool]'); if (tl) return tools().main[+tl.dataset.tool][1]();
    const mt = g('[data-mtool]'); if (mt) return tools().more.filter(Boolean)[+mt.dataset.mtool][1]();
    if (g('[data-pend-no]')) { S.pend = null; return render(); } if (g('[data-pend-yes]')) { const p = S.pend; S.pend = null; return p.run(); }
    if (g('[data-edit-no]')) { S.edit = null; return render(); } if (g('[data-edit-ok]')) { const v = $('#j2-edit').value, ed = S.edit; S.edit = null; render(); return ed.save(v); }
    const pr = g('[data-prod]'); if (pr) { const p = S.pick.products[+pr.dataset.prod]; S.pick = null; return op({ op: 'swap-product', patch: { product: { img: p.img, name: p.name } } }, `Now the ${p.name || 'other product'}`); }
    if (g('[data-pick-no]')) { S.pick = null; return render(); }
    const ow = g('[data-owner]'); if (ow) { S.pick = null; return brief({ owner: ow.dataset.owner }, `Now with ${ow.dataset.owner}`); }
    if (g('[data-area-go]')) { const v = $('#j2-area').value.trim(); if (!v) return toast('Say what goes in the box.'); const region = S.sel.region; return priced(`Change only that area: “${v}”`, usd(S.prices.area), () => { S.box = null; op({ op: 'background', target: 'bg', region, ask: v }, 'Area changed'); }); }
    if (g('[data-area]')) { S.area = !S.area; S.box = null; S.sel = null; return render(); }
    const sz = g('[data-size]'); if (sz) return op({ op: 'resize', patch: { size: sz.dataset.size } }, `Now ${S.recipes.__sizes?.[sz.dataset.size]?.label || sz.dataset.size}`);
    if (g('[data-hist]')) { S.hist = !S.hist; return render(); }
    const hd = g('[data-head]'); if (hd) { S.hist = false; return api('POST', `/api/jam2/jams/${S.jam.id}/boards/${board().id}/head`, { takeId: hd.dataset.head }).then((r) => { if (r?.jam) S.jam = r.jam; render(); }); }
    if (g('[data-redo]')) return redo();
    if (g('[data-redo-first]')) return op({ op: 'first' });
    if (g('[data-refresh]')) return take()?.scene ? priced('Remake it on the new idea: new words and a new picture', usd(S.prices.redo), () => op({ op: 'refresh' }, 'Remade on the new idea')) : op({ op: 'refresh' }, 'Remade on the new idea');
    if (g('[data-render]')) return render2();
    if (g('[data-copyopen]')) { const body = words().body || ''; navigator.clipboard?.writeText(body).catch(() => {}); const link = /^https?:\/\//.test(S.jam.concept?.spark?.link || '') ? S.jam.concept.spark.link : null; if (link) window.open(link, '_blank', 'noopener'); return toast(link ? 'Copied. The thread opened in a new tab: paste it as your reply.' : 'Copied. Paste it where the question was asked.'); }
    const sl = g('[data-slide]'); if (sl) { S.slide = +sl.dataset.slide; S.sel = null; return render(); }
    if (g('[data-whole]')) { S.sel = { kind: 'whole' }; return render(); }
    const sn = g('[data-sent]'); if (sn) { S.sel = { kind: 'sent', i: +sn.dataset.sent }; return render(); }
    if (g('[data-subject]')) { S.sel = { kind: 'subject' }; return render(); }
    const bk = g('[data-block]'); if (bk) { S.sel = { kind: 'block', i: +bk.dataset.block }; return render(); }
    const rw = g('[data-row]'); if (rw) { S.sel = { kind: 'row', i: +rw.dataset.row }; return render(); }
    const bf = g('[data-brief]'); if (bf) { S.sel = { kind: 'brief', i: +bf.dataset.brief }; return render(); }
    const sh = g('[data-shot]'); if (sh) { S.sel = { kind: 'shot', i: +sh.dataset.shot }; return render(); }
    const tk = g('[data-track]'); if (tk) { S.sel = { kind: 'track', which: tk.dataset.track }; return render(); }
    const art = g('[data-art]'); if (art && !S.area) { const l = g('.j2-l[data-id]'); const kind = l?.dataset.kind; S.more = false; S.pick = null;
      S.sel = l && kind !== 'shape' && kind !== 'bg' ? { kind, id: l.dataset.id, slide: board().kind === 'carousel' ? S.slide : null } : { kind: 'bg' }; return render(); }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (S.pend || S.edit || S.sel || S.fin || S.add) { S.pend = null; S.edit = null; S.sel = null; S.fin = false; S.add = false; S.area = false; return render(); } return close(); }
    if (e.key !== 'Enter') return;
    if (e.target.id === 'j2-in') { e.preventDefault(); return send(e.target.value); }
    if (e.target.id === 'j2-desc') { e.preventDefault(); return send(e.target.value); }
    if (e.target.id === 'j2-edit') { e.preventDefault(); const v = e.target.value, ed = S.edit; S.edit = null; render(); return ed.save(v); }
    if (e.target.id === 'j2-area') { e.preventDefault(); $('[data-area-go]')?.click(); }
    if (e.target.id === 'j2-posted') { e.preventDefault(); const link = e.target.value.trim(); if (!/^https?:\/\//.test(link)) return toast('Paste the link to the post.'); api('POST', `/api/jam2/jams/${S.jam.id}/posted`, { link, platform: new URL(link).host }).then(() => say('brew', 'Got it. Brew reads how it does and brings it back to your feed.')); }
  });
  /* select an area: drag a box on the picture */
  const rel = (e, el) => { const r = el.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  /* the box is drawn into the picture as the pointer moves; re-rendering here would drop the element the pointer is captured on */
  root.addEventListener('pointerdown', (e) => { const art = e.target.closest('[data-art]'); if (!S.area || !art) return; e.preventDefault(); const p = rel(e, art); try { art.setPointerCapture(e.pointerId); } catch {} S.start = p; S.box = { x: p.x, y: p.y, w: 0, h: 0 };
    $('.j2-box', art)?.remove(); const bx = document.createElement('div'); bx.className = 'j2-box'; Object.assign(bx.style, { left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: '0', height: '0' }); art.appendChild(bx); });
  root.addEventListener('pointermove', (e) => { if (!S.area || !S.start) return; const art = $('#j2 [data-art]'); if (!art) return; const p = rel(e, art); S.box = { x: Math.min(p.x, S.start.x), y: Math.min(p.y, S.start.y), w: Math.abs(p.x - S.start.x), h: Math.abs(p.y - S.start.y) }; const bx = $('.j2-box', art); if (bx) Object.assign(bx.style, { left: `${S.box.x * 100}%`, top: `${S.box.y * 100}%`, width: `${S.box.w * 100}%`, height: `${S.box.h * 100}%` }); });
  root.addEventListener('pointerup', () => { if (!S.area || !S.start) return; S.start = null; if (!S.box || S.box.w < 0.04 || S.box.h < 0.04) { S.box = null; return render(); } S.area = false; S.sel = { kind: 'area', region: S.box }; render(); setTimeout(() => $('#j2-area')?.focus(), 30); });
  window.addEventListener('resize', fit);
}

function close() { clearInterval(pollT); $('#j2')?.remove(); document.body.classList.remove('j2-open'); S = null; if (/^#jam2=/.test(location.hash)) history.replaceState(null, '', location.pathname); }

/* open a feed card's jam: the card's button decides what gets made */
async function open(card, cta, tapi) {
  api = tapi; $('#j2')?.remove(); S = fresh(); const s0 = S; const root = document.createElement('div'); root.id = 'j2'; root.tabIndex = -1; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Jam'); document.body.appendChild(root); document.body.classList.add('j2-open'); wire(root); render(); root.focus();
  const [r, cat] = await Promise.all([api('POST', '/api/jam2/open', { cardId: card?.id || null, cta: cta || null }), api('GET', '/api/jam2/catalogue')]);
  if (S !== s0) return; if (!r?.jam) { S.err = r?.error || 'This jam couldn’t open. Try again in a moment.'; return render(); }
  S.jam = r.jam; S.also = r.also || []; S.recipes = Object.fromEntries((cat?.recipes || []).map((x) => [x.id, x])); S.recipes.__sizes = cat?.sizes || {};
  history.replaceState(history.state, '', `${location.pathname}${location.search}#jam2=${S.jam.id}`);
  render(); poll(); const jid = S.jam.id; api('GET', `/api/jam2/jams/${jid}/prices`).then((p) => { if (live(s0, jid) && p?.prices) { S.prices = p.prices; render(); } });
}
/* ?v=2 turns Jam v2 on for this tab (it stays on while the tab is open); ?v=1 turns it off */
const on = () => { try { const v = new URLSearchParams(location.search).get('v'); if (v === '2') sessionStorage.setItem('brew-jam-v', '2'); if (v === '1') sessionStorage.removeItem('brew-jam-v'); return sessionStorage.getItem('brew-jam-v') === '2'; } catch { return false; } };
window.Jam2 = { on, open, close };
on();
