/* The team brief: what the people who make it work from. Not the jam's notes pasted: one AI pass turns the card, its proof,
   the plan, the jam brief and the final package into a brief that tells a team what to make, why, for whom, and the evidence
   behind each claim, with the final words verbatim and the creatives attached. Shaped like Jam v2's brief (jam2/core.js briefOf):
   fixed sections, each one editable in place. Kept on the jam (w.teamBrief) for the version it was written from; a new version
   of the package writes it again, keeping the person's own edits.
   Shown on the studio's stage (brief mode), downloaded as a PDF, or sent as an email draft with the PDF and the files attached. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { saveGen, genFile } from './gen-store.js';
import { withBrowser } from './pdf/render.js';

export const TB_V = 4; // bump when the brief starts being written differently: every saved one is written again
export const SECTIONS = [['what', 'What to make'], ['why', 'Why we’re doing it'], ['who', 'Who it’s for'], ['words', 'The words · final'], ['creative', 'The creative'],
  ['specs', 'Specs'], ['rules', 'Must-haves and don’ts'], ['when', 'Budget, timing and owner'], ['measure', 'How we measure it'], ['done', 'Done when'], ['open', 'Still to confirm']];
const AI_KEYS = ['what', 'why', 'who', 'creative', 'specs', 'rules', 'when', 'done'];
const PDF_FONT = pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname), 'pdf', 'fonts', 'Inter-Variable.ttf')).href;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const one = (s, n = 900) => { s = String(s ?? '').replace(/[ \t]+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const genName = (u) => { const m = /(?:^|\/)gen\/([a-z0-9_-]{6,64}\.(?:png|jpg|mp4))$/i.exec(String(u || '')); return m ? m[1] : null; };
/* the brand's own files: a made one (gen/…) or one of its pack (b/<slug>/…), as a path on this server; anything else is not ours to attach */
const ownPath = (u) => { const s = String(u || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '').split('?')[0]; return /^(gen\/[a-z0-9_-]{6,64}|b\/[a-z0-9-]+\/[\w./-]+)\.(png|jpe?g|webp|mp4)$/i.test(s) && !s.includes('..') ? s : null; };
const SELF = () => `http://127.0.0.1:${process.env.PORT || 8080}/`;
const fmtM = (m) => { if (!m?.metric) return '';
  const u = (v) => (v == null ? '' : /^(₹|\$|£|€)$/.test(m.unit || '') ? `${m.unit}${Math.round(v).toLocaleString(m.unit === '₹' ? 'en-IN' : 'en-US')}` : m.unit === '%' ? `${(+v).toFixed(1)}%` : `${v}${m.unit && m.unit !== 'x' ? ' ' + m.unit : m.unit === 'x' ? 'x' : ''}`);
  return `${m.metric}${m.baseline != null ? `: from ${u(m.baseline)}` : ''}${m.target != null ? `${m.baseline != null ? ' to' : ', target'} ${u(m.target)}` : ''}${m.window ? `, read after ${m.window} days` : ''}.`; };

export function createTeamBrief({ claudeTool, isMock = () => true, spend = () => false, clean = (x) => x, now = () => Date.now(), handoff, proofOf = () => null, log = console }) {
  /* the files that go with it: the package's own pictures and videos (a rival's are never ours: handoff leaves them out) */
  const creativesOf = (x) => { const seen = new Set();
    return (x.pkg?.assets || []).filter((a) => (a.kind === 'image' || a.kind === 'video') && ownPath(a.url)).filter((a) => { const n = ownPath(a.url); if (seen.has(n)) return false; seen.add(n); return true; })
      .map((a, i, all) => ({ kind: a.kind, label: a.label || (a.kind === 'video' ? 'Video' : 'Picture'), url: ownPath(a.url), poster: ownPath(a.poster),
        /* the file name the receiving team sees: the brand and what it is, never Brew's own label ("The card this came from") */
        name: `${`${x.brand || 'Brand'} ${a.kind === 'video' ? 'video' : 'creative'}${all.length > 1 ? ` ${i + 1}` : ''}`.replace(/[\/\\:*?"<>|]+/g, ' ').trim()}.${ownPath(a.url).split('.').pop().replace('jpeg', 'jpg')}` })); };
  const wordsOf = (x) => (x.pkg?.fields || []).filter((f) => f.pub).map((f) => `${f.label}: ${f.value}`).join('\n') || (x.pkg?.fields || []).slice(0, 6).map((f) => `${f.label}: ${f.value}`).join('\n');
  const keyOf = (w, x) => `${TB_V}|${x.pkg?.id || ''}|${x.pkg?.version || 0}|${w.doc?.rev || 0}`;

  /* everything the writer may use, each piece named so the evidence can say where it came from */
  const materials = (t, w, x) => {
    const L = [`Brand: ${x.brand}`, `The card (${x.card.agent}${x.card.type ? `, ${x.card.type}` : ''}): ${x.card.title}`, one(x.card.sub, 500)];
    if (x.card.rows.length) L.push('Card facts:', ...x.card.rows.slice(0, 8).map(([k, v]) => `- ${k}: ${v}`));
    if (x.card.why?.length) L.push('Why the card was suggested:', ...x.card.why.slice(0, 5).map((s) => `- ${one(s, 240)}`));
    const pr = proofOf(t, w); if (pr) L.push('The card’s proof (where its numbers come from):', one(pr, 1400));
    if (x.page?.reason) L.push(`The reasoning: ${one(x.page.reason, 500)}`);
    if (x.decided) L.push(`Decided: ${x.decided.name}. ${one(x.decided.says, 240)} What changes: ${one(x.decided.effect, 240)}`);
    if (x.page?.moves?.length) L.push('From the brand’s plan (moves):', ...x.page.moves.slice(0, 3).map((m) => `- Move ${m.n}: ${one(m.says || m.plain || m.title, 260)}`));
    if (x.pkg) L.push(`The package: ${x.pkg.action} on ${x.pkg.target} (v${x.pkg.version}) · ${x.pkg.money} · ${x.pkg.undo}`, 'Its fields:', ...x.pkg.fields.map((f) => `- ${f.label}${f.pub ? ' (customers see this)' : ''}: ${one(f.value, 400)}`));
    const cr = creativesOf(x); if (cr.length) L.push(`Files attached: ${cr.map((c) => c.label).join(', ')}`);
    if (x.pkg?.notes?.length) L.push('The team’s notes:', ...x.pkg.notes.map((n) => `- ${one(n, 200)}`));
    if (x.pkg?.checks?.length) L.push('Their own checks before it ships:', ...x.pkg.checks.map((c) => `- ${c.text}${c.done ? ' (done)' : ''}`));
    if (x.measure) L.push(`How it’s measured: ${fmtM(x.measure)}`);
    if (x.brief?.md) L.push('The jam brief the team wrote together:', '"""', one(x.brief.md, 3500), '"""');
    const asked = (x.pkg?.thread || []).filter((m) => !/\(studio\)$/.test(m.who)).slice(-6); if (asked.length) L.push('What the team asked for while making it:', ...asked.map((m) => `- ${one(m.text, 200)}`));
    const open = x.questions.filter((q) => !q.a); if (open.length) L.push('Open questions:', ...open.slice(0, 5).map((q) => `- ${q.q}`));
    return L.join('\n'); };

  const SCHEMA = { type: 'object', required: ['title', ...AI_KEYS, 'open', 'evidence'], properties: {
    title: { type: 'string', description: 'The brief’s title: what is being made, under 10 words' },
    what: { type: 'string', description: 'What to make: the deliverable, format, where it runs. 1 to 3 sentences' },
    why: { type: 'string', description: 'Why: the problem or opportunity and what it should change, in 2 to 4 sentences' },
    who: { type: 'string', description: 'Who it’s for: the audience, as specific as the materials allow' },
    creative: { type: 'string', description: 'The creative: what the attached picture or video is, what to keep exactly (the real product, its label), the look and the one idea it must land' },
    specs: { type: 'string', description: 'Specs: sizes, lengths, file types, placements; one per line' },
    rules: { type: 'string', description: 'Must-haves and don’ts: rules only (which claims may be made and how, the real product photo, brand do’s and don’ts), one per line. Never restate the copy: it has its own section' },
    when: { type: 'string', description: 'Budget, timing and owner, only as the materials say; "To confirm" for any part they don’t' },
    done: { type: 'string', description: 'Done when: what the team hands back (files, sizes, links) and who approves it; not how results are measured' },
    open: { type: 'array', items: { type: 'string' }, description: 'What is still to confirm before it runs, each under 16 words; empty if nothing' },
    evidence: { type: 'array', items: { type: 'object', required: ['say', 'src'], properties: { say: { type: 'string', description: 'One fact that backs this brief, with its number when there is one, under 30 words' }, src: { type: 'string', description: 'Where it comes from, named plainly: the card’s proof, Move 12, Meta Ads account, store reviews, a rival’s live ads…' } } }, description: '3 to 7 facts, the strongest first; only facts in the materials' } } };

  const fallback = (w, x) => { const bp = w.doc?.plan || {};
    return { title: x.pkg ? `${x.pkg.action}: ${x.card.title}` : x.title, what: x.pkg ? `${x.pkg.family}: ${x.pkg.action} on ${x.pkg.target}.` : x.card.title, why: one(x.page?.reason || x.card.sub, 500),
      who: bp.audience || 'To confirm.', creative: creativesOf(x).length ? `Use the attached ${creativesOf(x).length === 1 ? (creativesOf(x)[0].kind === 'video' ? 'video' : 'picture') : 'files'} as the final. Keep the real product exactly as it is.` : 'To confirm.',
      specs: 'As the placement needs; to confirm.', rules: 'Use the real product photo, never a redrawn one.\nOnly claims the store and its reviews already make.', when: [bp.when, bp.budget, bp.owner].filter(Boolean).join(' · ') || 'To confirm.',
      done: 'The final files are back in the jam and approved.', open: [...(x.brief?.missing || []), ...x.questions.filter((q) => !q.a).map((q) => q.q)].slice(0, 6),
      evidence: x.card.rows.slice(0, 5).map(([k, v]) => ({ say: `${k}: ${v}`, src: 'The card' })) }; };

  const write = async (t, w, x) => {
    if (!isMock() && spend('text')) {
      try {
        const j = await claudeTool(`You write the brief a team works from to make this for ${x.brand}: an agency, a designer, a media buyer or the brand’s own team. They were not in the jam. Give them everything they need to make it right the first time: what to make, why, for whom, the evidence behind it, the final words, the creative, the specs, the rules, timing, how it’s judged.\n\nMaterials:\n${materials(t, w, x)}\n\nRules: plain short sentences, written to the team ("Make…", "Keep…"). Every number and claim only from the materials, never invented; "To confirm" where they don’t say. No internal words (move, card, jam, Brew’s agents). Don’t repeat the final words: they are printed as they are in their own section. Evidence: each fact once, its source named plainly.`, SCHEMA, 3500, 'team_brief');
        const pick = (k) => clean(String(j?.[k] || '')).trim();
        if (AI_KEYS.every((k) => pick(k))) return { ai: true, title: pick('title'), ...Object.fromEntries(AI_KEYS.map((k) => [k, pick(k)])),
          open: (j.open || []).map((s) => clean(String(s)).trim()).filter(Boolean).slice(0, 8), evidence: (j.evidence || []).map((e) => ({ say: clean(String(e.say || '')).trim(), src: clean(String(e.src || '')).trim() })).filter((e) => e.say).slice(0, 8) };
      } catch (e) { log.warn?.('[team brief]', e.message); }
    }
    return { ai: false, ...fallback(w, x) }; };

  /* the brief for the version on the stage: written once per version (and per jam-brief edit), else the saved one */
  const build = async (t, w, { fresh = false } = {}) => {
    const x = await handoff.build(t, w, { base: '' }); const key = keyOf(w, x), old = w.teamBrief;
    if (old && old.key === key && !fresh && old.ai) return { tb: old, x };
    const d = await write(t, w, x), m = fmtM(x.measure || w.doc?.measure || null);
    /* the rules are rules: a line that restates the final words ("Use the exact headline: …") is dropped, the words have their own section */
    const fv = (x.pkg?.fields || []).map((f) => String(f.value || '').toLowerCase().replace(/\s+/g, ' ').trim()).filter((v) => v.length >= 12);
    if (d.rules) d.rules = d.rules.split('\n').filter((l) => { const q = l.toLowerCase().replace(/\s+/g, ' '); return !/^\W*(use the exact|.{0,40}\bmust (be|read)\s*:)/i.test(l) && !fv.some((v) => q.includes(v.slice(0, 40))); }).join('\n').trim() || d.rules;
    const auto = { ...Object.fromEntries(AI_KEYS.map((k) => [k, d[k]])), words: wordsOf(x) || 'To confirm.', measure: m || 'To confirm.', open: (d.open || []).length ? d.open.map((s) => `- ${s}`).join('\n') : 'Nothing open.' };
    const edits = old?.edits || {};
    w.teamBrief = { v: TB_V, key, ai: d.ai, at: now(t), title: d.title || x.title, auto, edits, evidence: d.evidence || [], creatives: creativesOf(x), version: x.pkg?.version || null, pdf: null,
      brand: x.brand, mark: x.mark || null, memo: { from: x.memo?.from || null, to: 'Your team' } }; /* a brief to hand over: their own team or agency (Send to the ShopOS team stays its own button) */
    return { tb: w.teamBrief, x }; };
  const view = (w, x) => { const tb = w.teamBrief; if (!tb) return null;
    return { title: tb.title, at: tb.at, ai: tb.ai, version: tb.version, stale: !!x && keyOf(w, x) !== tb.key, brand: tb.brand || '', mark: tb.mark || null,
      memo: { from: tb.memo?.from || null, to: tb.memo?.to || 'Your team', due: w.doc?.plan?.when || null, ref: w.ticket || null },
      sections: SECTIONS.map(([k, h]) => ({ k, h, t: tb.edits[k] ?? tb.auto[k] ?? '', edited: tb.edits[k] != null, locked: k === 'words' })), evidence: tb.evidence, creatives: tb.creatives, pdf: tb.pdf }; };

  /* the PDF: Brew's own type, the creatives large on the first page, then every section and the evidence */
  const pdfHtml = async (v) => {
    const fileUrl = async (u) => { const n = genName(u); const f = n ? await genFile(n) : null; return f ? pathToFileURL(f).href : ownPath(u) ? SELF() + ownPath(u) : null; };
    const pics = []; for (const c of v.creatives.slice(0, 4)) { const src = await fileUrl(c.kind === 'video' ? c.poster : c.url); if (src) pics.push({ src, label: c.label, video: c.kind === 'video' }); }
    const md = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => /^[-•]\s+/.test(l) ? `<li>${esc(l.replace(/^[-•]\s+/, ''))}</li>` : `<p>${esc(l)}</p>`).join('').replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
    const day = new Date(v.at || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      @font-face{font-family:Inter;src:url('${PDF_FONT}') format('truetype');font-weight:100 900}
      @page{size:A4;margin:16mm 16mm 18mm}
      *{box-sizing:border-box}body{font:10.5pt/1.55 Inter,-apple-system,Helvetica,Arial,sans-serif;color:#171717;margin:0}
      .k{font-size:8pt;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600}
      header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e7eb;padding-bottom:10px;margin-bottom:18px}
      header .b{font-weight:700;font-size:11pt}h1{font-size:22pt;line-height:1.15;margin:4px 0 14px;font-weight:700;letter-spacing:-.01em}
      dl.memo{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 18px;padding:10px 12px;background:#f6f6f5;border-radius:10px}
      dl.memo dt{font-size:7.5pt;text-transform:uppercase;letter-spacing:.06em;color:#6b7280}dl.memo dd{margin:2px 0 0;font-weight:600;font-size:9.5pt}
      .pics{display:flex;gap:10px;margin:0 0 20px}.pics figure{margin:0;flex:1;max-width:48%}.pics img{width:100%;border-radius:10px;border:1px solid #e5e7eb;display:block}
      .pics figcaption{font-size:8pt;color:#6b7280;margin-top:4px}
      section{break-inside:avoid;margin:0 0 14px}section h2{font-size:8.5pt;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin:0 0 4px;font-weight:600}
      section p{margin:0 0 4px}ul{margin:0 0 4px;padding-left:16px}li{margin:0 0 2px}
      .words{background:#f6f6f5;border-left:3px solid #171717;padding:8px 12px;border-radius:6px;white-space:pre-wrap}
      .ev li{list-style:none;margin:0 0 6px;padding:0}.ev{padding:0}.ev .src{display:inline-block;font-size:7.5pt;color:#374151;background:#eef0f2;border-radius:99px;padding:1px 7px;margin-left:6px}
      footer{margin-top:22px;border-top:1px solid #e5e7eb;padding-top:8px;font-size:8pt;color:#9ca3af}
    </style></head><body>
      <header><span class="b">${esc(v.brand)}</span><span class="k">Brief${v.memo.ref ? ` · ${esc(v.memo.ref)}` : ''} · ${esc(day)}</span></header>
      <div class="k">A brief for the team that makes it</div><h1>${esc(v.title)}</h1>
      <dl class="memo"><div><dt>From</dt><dd>${esc(v.memo.from || `${v.brand} team`)}</dd></div><div><dt>To</dt><dd>${esc(v.memo.to)}</dd></div><div><dt>Due</dt><dd>${esc(v.memo.due || 'To confirm')}</dd></div><div><dt>Version</dt><dd>${v.version ? `v${v.version}` : '—'}</dd></div></dl>
      ${pics.length ? `<div class="pics">${pics.map((p) => `<figure><img src="${p.src}"><figcaption>${esc(p.label)}${p.video ? ' · video attached' : ' · attached'}</figcaption></figure>`).join('')}</div>` : ''}
      ${v.sections.map((s) => (s.k === 'words' ? `<section><h2>${esc(s.h)}</h2><div class="words">${esc(s.t)}</div></section>` : `<section><h2>${esc(s.h)}</h2>${md(s.t)}</section>`)
        + (s.k === 'why' && v.evidence.length ? `<section><h2>The evidence</h2><ul class="ev">${v.evidence.map((e) => `<li>${esc(e.say)}${e.src ? `<span class="src">${esc(e.src)}</span>` : ''}</li>`).join('')}</ul></section>` : '')).join('')}
      <footer>${esc(v.brand)} · written with Brew from the brand’s own store, accounts and plan. The attached files are the final creatives.</footer>
    </body></html>`; };
  const pdfOf = async (v) => { const html = await pdfHtml(v);
    const tmp = path.join(os.tmpdir(), `brew-tb-${process.pid}-${crypto.randomBytes(4).toString('hex')}.html`); fs.writeFileSync(tmp, html);
    try { return await withBrowser(async (b) => { const page = await b.newPage(); try { await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load', timeout: 60e3 }); await page.evaluate(() => document.fonts.ready.then(() => true)); return Buffer.from(await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true, timeout: 120e3 })); } finally { await page.close().catch(() => {}); } }); }
    finally { fs.rmSync(tmp, { force: true }); } };
  const fileName = (v) => `${String(`${v.brand ? v.brand + ' brief' : 'Brief'} - ${v.title}`).replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90).replace(/[.\s]+$/, '')}.pdf`;

  const routes = ({ on, W }) => {
    on('GET', '/api/work/:wid/team-brief', async (b, t, p, q) => { const w = W(t, p.wid); if (!w) return { error: 'not found' };
      const { x } = await build(t, w, { fresh: q?.get?.('fresh') === '1' }); return { brief: view(w, x) }; });
    /* a quick edit of one section; an empty text puts the written one back. The final words are the package's: changed in the studio */
    on('POST', '/api/work/:wid/team-brief/edit', async (b, t, p) => { const w = W(t, p.wid); if (!w?.teamBrief) return { error: 'not found' };
      const k = String(b.k || ''); if (!SECTIONS.some(([s]) => s === k) || k === 'words') return { error: 'That part can’t be edited here.' };
      const tx = String(b.t ?? '').trim().slice(0, 4000); if (tx && tx !== w.teamBrief.auto[k]) w.teamBrief.edits[k] = tx; else delete w.teamBrief.edits[k];
      w.teamBrief.pdf = null; w.updatedAt = now(t); return { brief: view(w, null) }; });
    on('POST', '/api/work/:wid/team-brief/evidence', async (b, t, p) => { const w = W(t, p.wid); if (!w?.teamBrief) return { error: 'not found' };
      const i = +b.i; if (!(i >= 0 && i < w.teamBrief.evidence.length)) return { error: 'not found' }; w.teamBrief.evidence.splice(i, 1); w.teamBrief.pdf = null; return { brief: view(w, null) }; });
    /* the PDF, made once per state of the brief and kept in gen/ */
    on('POST', '/api/work/:wid/team-brief/pdf', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' };
      const { x } = await build(t, w); const v = view(w, x); if (w.teamBrief.pdf && !b.fresh) return { pdf: w.teamBrief.pdf, brief: v };
      try { const buf = await pdfOf(v), name = `brief-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20)}.pdf`; saveGen(name, buf);
        w.teamBrief.pdf = { url: `gen/${name}`, name: fileName(v), bytes: buf.length, at: now(t) }; return { pdf: w.teamBrief.pdf, brief: view(w, x) }; }
      catch (e) { log.warn?.('[team brief pdf]', e.message); return { error: 'The PDF didn’t come together. Try again.' }; } });
  };
  return { build, view, routes, pdfHtml };
}
