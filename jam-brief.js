import { B, BN, BH, CTRY, FESTN, FESTD } from './brand-ctx.js';
/* The jam brief: one free-flowing document per jam, in Markdown (w.doc).
   It starts as the continuation of the card (what it says, what it recommends, how we measure it, what the moves say)
   and grows as people jam: you type in it, you add selections from the card or the moves, AI edits it on request,
   and teammates' and the ShopOS team's replies fold in. It ends as the brief the next people work from.
   Readiness is a quiet checklist of what's still missing for this kind of work, never a score. */

import { promptBlock, versionsOf } from './learn.js';
import { fieldsFor, FAMILY_NAME } from './studio.js';
import { acctRows } from './connectors/common.js';
import { EVIDENCE_ASK } from './evidence.js'; // "what's the evidence?" is answered from the card's proof
import { isQuestion, answerGrounded } from './jam-answer.js'; // a question is answered from the brief and the facts, the brief untouched
import { planMd, PLAN_V, oneOf } from './card-plan.js';
import { MEASURE_SCHEMA, MEASURE_ASK, vetMeasure, measureFromMd } from './measure-spec.js';
import { startStatus, moveStatus, LABEL } from './brief-status.js';
import { moveLabel, moveNum, moveSay } from './move-label.js'; // weekly moves read "Weekly move 11", never "Move 1011" (QA FEED-QA-12)

// what a brief for each kind of work must say before someone can act on it: [label, pattern that shows it's covered]
const NEEDS = {
  common: [['How we measure it', /\b(measure|metric|target|kpi|cpa|roas|ctr|conversion|orders?|replies|reviews? (a|per)|rate)\b/i], ['Who owns it', /\b(owner|owns|signs? off|decides|approv|lead\b|founder|brand manager|growth lead)\b/i], ['When', /\b(by |before |on )?(mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(today|tomorrow|this week|next week|deadline|launch date|go live|goes live|\d{1,2} (oct|nov|dec|jan|feb)\w*|(oct|nov|dec|jan|feb)\w* \d{1,2}|day \d+)\b/i]],
  ad: [['Who it’s for', /\b(audience|women|men|aged?|\d{2}\s*[-–to]+\s*\d{2}|buyers|people who|lookalike|retarget)/i], ['Where it runs', /\b(meta|instagram|facebook|reels|stories|feed|placement|youtube|google)\b/i], ['Budget', /(₹|\bbudget\b|\bspend\b|per day|a day|a week)/i]],
  ops: [['Which campaigns', /\b(campaign|ad sets?|adset)\b/i], ['How much spend moves', /(₹|\bbudget\b|\bspend\b|%)/i]],
  store: [['Which pages', /\b(page|pdp|product page|collection|home ?page|checkout|cart|\/products\/|\/pages\/|\.(?:com|in|co|store|shop)\/)/i]],
  crm: [['Who gets it', /\b(segment|buyers|customers|subscribers|people who|anyone who|past day|cohort)\b/i], ['Channel and timing', /\b(whatsapp|email|sms|push)\b/i], ['Who is left out', /\b(exclude|left out|leave out|never|opt[- ]?out|not send|skip)\b/i]],
  catalog: [['Which marketplaces', /\b(amazon|flipkart|nykaa|blinkit|zepto|instamart|myntra|marketplace)\b/i]],
  vis: [['Sources for every claim', /\b(source|study|claims list|cited|as of)\b/i]],
  brief: [['Deliverables', /\b(film|cut|reel|video|stills?|deliverables?|\d+s\b|seconds)\b/i], ['Budget', /(₹|\bbudget\b|\bcost\b)/i]],
  decision: [['What changes once decided', /\b(changes?|then|next|follow|after)\b/i]],
  general: []
};
const profileOf = (c = {}, ch) => {
  const fam = ch?.family;
  if (fam) return { meta_ad: 'ad', meta_ops: 'ops', store: 'store', crm: 'crm', vis: 'vis', brief: 'brief', decision: 'decision', listing: 'catalog' }[fam] || 'general';
  if (c.kind === 'conflict' || (c.type === 'decision' && c.options)) return 'decision';
  if (c.kind === 'film') return 'brief';
  // a Brew plan or report is a decision, not a message to customers
  if (c.agent === 'brew' && c.type !== 'idea') return 'decision';
  if (c.agent === 'crm' || (c.sector === 'signals' && /whatsapp|message|sms|email|nudge|send/i.test(`${c.title} ${c.cta?.label || ''}`))) return 'crm';
  if (c.sector === 'signals') return 'general';
  if (c.sector === 'storefront') return 'store';
  if (c.sector === 'catalog') return 'catalog';
  if (c.sector === 'visibility') return 'vis';
  if (c.sector === 'ads' && !c.images) return 'ops';
  if (c.sector === 'ads' || c.sector === 'creatives') return 'ad';
  return 'general';
};
const KIND = { ad: 'Ad brief', ops: 'Ad account brief', store: 'Store change brief', crm: 'Customer message brief', catalog: 'Listing brief', vis: 'AI answers brief', brief: 'Production brief', decision: 'Decision brief', general: 'Brief' };
// the plan at a glance: for each thing this kind of brief needs, the line in the brief that says it
const plainLine = (l) => String(l).replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').replace(/\*\*|__|`/g, '').replace(/^[^:]{2,40}:\s+(?=\S)/, (m) => m).trim();
const clip = (s, n) => s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…';
export const specOf = (md, profile) => { const lines = String(md || '').split('\n').filter((l) => l.trim() && !/^#/.test(l));
  const used = new Set(); return [...NEEDS.common, ...(NEEDS[profile] || [])].map(([label, re]) => { const hit = lines.find((l) => re.test(l) && !used.has(l)) || lines.find((l) => re.test(l)); if (hit) used.add(hit); return { label, value: hit ? clip(plainLine(hit), 120) : '' }; }); };
export const hookOf = (md) => { const m = String(md || '').match(/["“]([^"”\n]{8,90})["”]/); return m ? m[1].trim() : ''; };
export const missingOf = (md, profile) => [...NEEDS.common, ...(NEEDS[profile] || [])].filter(([, re]) => !re.test(md)).map(([l]) => l);

const trim = (s, n = 400) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const bullets = (xs) => (xs || []).filter(Boolean).map((x) => `- ${trim(x, 300)}`).join('\n');
const fmtMeasure = (m) => {
  if (!m?.metric) return '';
  const u = (v) => (v == null ? '' : /^(₹|\$|£|€|[ACS]\$)$/.test(m.unit || '') ? `${m.unit}${Math.round(v).toLocaleString(m.unit === '₹' ? 'en-IN' : 'en-US')}` : m.unit === '%' ? `${(+v).toFixed(1)}%` : `${v}${m.unit && m.unit !== 'x' ? ' ' + m.unit.trim() : ''}`);
  return `${m.metric}${m.baseline != null ? `: from ${u(m.baseline)}` : ''}${m.target != null ? ` to ${u(m.target)}` : ''}${m.window ? `, read after ${m.window} days` : ''}${m.fromName ? ` (from ${m.fromName})` : ''}.`;
};

export function createJamBrief(o) {
  const { claudeTool, cardBrief, seatLine, isMock, spend, clean = (x) => x, now, AGENT = {}, log = console, cardOf = (t, id) => t.cards.get(id), measureOf = () => null, MOVES = null, changeOf = () => null, pageOf = () => null } = o;

  // the first draft, written from the card and its page: no AI, no cost. It reads like a brief a client would
  // sign: what we're deciding, the plan (their choice, else the Brew pick), what changes, why, how we measure it.
  // The moves are one line of backing, never a list. Everything after this is the jam's.
  const draftFrom = (t, c, w, decided) => {
    const d = c.detail || {}, v = w ? (w.versions || []).find((x) => x.n === w.current) : null, ch = w ? changeOf(t, w) : null;
    const pg = pageOf(t, c), opts = pg?.options || [], dec = decided || w?.decided, chosen = opts.find((o) => o.id === dec), pick = chosen || opts.find((o) => o.pick) || opts[0];
    const cm = c.measure || w?.measure || measureOf(t, c) ? { ...measureOf(t, c), ...(w?.measure || {}) } : null;
    const lead = pg?.lead && pg.lead !== c.sub ? pg.lead : '', cp = w?.cardPlan || o.planOf?.(t, c) || null;
    const parts = [`# ${trim(v?.title || c.title, 140)}`, trim(v?.sub || c.sub, 300)];
    if (lead) parts.push(`**The call:** ${trim(lead, 220)}`);
    const plan = [];
    if (pick) {
      plan.push(`**${chosen ? 'We go with' : 'Brew recommends'}:** ${pick.name}. ${trim(pick.says, 200)}`);
      if (pick.effect) plan.push(`**What changes:** ${trim(pick.effect, 220)}`);
      /* one, always (Param, 19 Oct): the brief carries the one way forward, never the other options */
    } else if (d.how?.length && !cp) plan.push(...d.how.slice(0, 3));
    if (ch?.after?.publicText?.length) plan.push(`**The package:** ${ch.actionLabel} on ${ch.target?.name || 'the connected tool'}.`);
    /* the card's plan is the jam's input: its steps toward the card's action, ending on that action */
    if (plan.length || cp) parts.push(`## The plan\n${[plan.length ? bullets(plan) : '', cp ? planMd(cp) : ''].filter(Boolean).join('\n\n')}`);
    const why = [...new Set([chosen ? '' : pg?.reason, ...(d.why || []).slice(0, 2)].filter(Boolean))];
    if (why.length) parts.push(`## Why\n${bullets(why.map((x) => trim(x, 220)))}`);
    const om = pick?.measure;
    if (om?.metric) parts.push(`## How we measure it\n${bullets([`${om.metric}${om.where ? ` (${om.where})` : ''}. ${om.target ? `Target: ${om.target}.` : 'Target: set with you before go-live.'} Read on day ${om.window}.`, om.guard ? (/^if\s/i.test(om.guard) ? `We stop ${om.guard.charAt(0).toLowerCase() + om.guard.slice(1).replace(/\.$/, '')}.` : `**Stop rule:** ${om.guard.replace(/\.$/, '')}.`) : ''])}`);
    else { const mt = fmtMeasure(cm); if (mt) parts.push(`## How we measure it\n${mt}`); }
    if (c.needs) parts.push(`## Who decides\n${c.needs}${/\.$/.test(c.needs) ? '' : '.'}`);
    if (d.watch) parts.push(`## Watch-outs\n${trim(d.watch, 240)}`);
    const ns = MOVES ? MOVES.numsOf(c.src) : [];
    if (ns.length) parts.push(`## Backed by\n${ns.length > 3 ? `${ns.length} of the plans Brew wrote for ${BN()} (${ns.map(moveLabel).join(', ').replace(/, ([^,]+)$/, ' and $1')}).` : ns.map((n) => `${moveLabel(n)}: ${MOVES.short ? MOVES.short(n) : ''}`).join(' · ')}`);
    return parts.filter(Boolean).join('\n\n');
  };
  // several cards jammed together ("Jam on all"): one brief, one plan per card. They stay separate unless someone asks to merge them.
  const bundleOf = (t, c) => (Array.isArray(c?.bundle) ? c.bundle.map((id) => cardOf(t, id)).filter(Boolean) : []);
  const bundleFrom = (t, c) => {
    const cs = bundleOf(t, c);
    const plans = cs.map((x, i) => draftFrom(t, x, null, t.decided?.[x.id] || null).replace(/^# (.+)$/m, `## Plan ${i + 1}: $1`).replace(/^## (?!Plan \d)/gm, '### '));
    return [`# ${c.title}`, `${cs.length} separate plans in one brief, one per card. Each keeps its own owner, measure and timing. Ask in the chat if you want them merged into one plan.`, ...plans].join('\n\n');
  };
  const MULTI = (t, c) => { const n = bundleOf(t, c).length; return n > 1 ? `\nThis brief holds ${n} SEPARATE plans, one "## Plan N: ..." section per card. Keep them separate: edit only the plan(s) the request is about, and never merge, combine or summarise them into one plan unless the person explicitly asks to merge or combine them. Things that apply to all of them go in a short "## Across all plans" section at the end.` : ''; };
  const out = (t, w) => { const c = cardOf(t, w.cardId) || {}; const p = profileOf(c, changeOf(t, w)); w.doc.profile = p; w.doc.kind = KIND[p]; w.doc.missing = missingOf(w.doc.md, p).filter((l) => !(l === 'Where it runs' && o.targetOf?.(t, w))); /* the target tool is known: not missing */ w.doc.checks = [...NEEDS.common, ...(NEEDS[p] || [])].map(([l]) => l); w.doc.spec = specOf(w.doc.md, p); w.doc.hook = hookOf(w.doc.md); return w.doc; };
  // a card's brief before anyone jams on it (no work item is created just by looking)
  const preview = (t, c, decided) => { const p = profileOf(c); const md = bundleOf(t, c).length ? bundleFrom(t, c) : draftFrom(t, c, null, decided); return { md, rev: 0, kind: KIND[p], profile: p, missing: missingOf(md, p) }; };

  /* briefs saved while the AI was off kept the studio's sync instruction as a note ("Brew: The package is now v2 … Make the brief
     match it exactly, keep everything else: …"): it was never meant to be read, so it leaves the brief on load */
  const SYNC_NOTE = /^- (?:Brew: )?The [^\n]{0,80} is now v\d+[^\n]*Make the brief match it exactly, keep everything else:[^\n]*\n?/gm;
  /* every brief prompt opens with the brand's fact sheet ("# Cozy Snugglet brand brief", its tables and [k:…] source tags).
     Asked to "make the brief match" the package, the AI once pasted all of it into a jam's brief (Cozy, 22 Oct). The fact sheet is
     reference only: any of its sections the jam brief didn't already have are cut back out of an AI edit, and a saved brief
     carrying its source tags is cleaned when it loads */
  const factOf = () => { try { return String(cardBrief({ title: '', sub: '', agent: '' }, '') || '').split('\n\nCard (by the ')[0]; } catch { return ''; } };
  const headsOf = (md) => new Set((String(md || '').match(/^#{1,3}[ \t]+.+$/gm) || []).map((h) => h.replace(/^#+[ \t]+/, '').trim().toLowerCase()));
  const KTAG = /\[k:[^\]\n]{1,120}\]/g;
  const unleak = (md, before, title) => { const fh = headsOf(factOf()), had = headsOf(before); if (!fh.size) return md;
    const keep = []; let skip = false;
    for (const line of String(md).split('\n')) { const m = /^(#{1,3})[ \t]+(.+)$/.exec(line); if (m) { const h = m[2].trim().toLowerCase(); skip = fh.has(h) && !had.has(h); } if (!skip) keep.push(line); }
    let out = keep.join('\n'); if (!KTAG.test(before || '')) out = out.replace(KTAG, ''); KTAG.lastIndex = 0;
    out = out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    if (title && !/^# /m.test(out)) out = `# ${trim(title, 140)}\n\n${out}`; return out; };
  const seed = (t, w) => {
    if (w.doc?.md && /\[k:[^\]\n]{1,120}\]/.test(w.doc.md)) { const md = unleak(w.doc.md, '', w.title); if (md !== w.doc.md && md.length > 40) { w.doc.md = md; w.doc.rev = (w.doc.rev || 1) + 1; w.doc.healedLeak = now(t); } }
    /* one, always (Param, 19 Oct): a jam saved with a plan of options (plan v1: "Write 3 new versions", "Draft the two new hook
       variants") rebuilds it from the card, and its brief follows: rewritten when nobody touched it, else its plan section is
       swapped for the new one and any count of takes in it said as one. The case, the brief and the card's button read this */
    if (w.cardId && w.cardPlan && w.cardPlan.v !== PLAN_V) { const c0 = cardOf(t, w.cardId); const fresh = c0 && o.planOf?.(t, c0);
      if (fresh) { const made = w.cardPlan.made; w.cardPlan = { ...fresh, ...(made ? { made } : {}) };
        if (w.doc?.md) { if ((w.doc.rev || 1) <= 1 && !(w.doc.edits || []).length && !bundleOf(t, c0).length) { w.doc.md = draftFrom(t, c0, w); w.doc.plan = null; w.doc.measure = null; }
          else w.doc.md = w.doc.md.replace(/(## The plan\n)([\s\S]*?)(?=\n## |$)/, (m0, h, body) => `${h}${/\*\*Next:\*\*/.test(body) ? planMd(w.cardPlan) : oneOf(body)}`); } } }
    if (w.doc?.md && SYNC_NOTE.test(w.doc.md)) { SYNC_NOTE.lastIndex = 0; w.doc.md = w.doc.md.replace(SYNC_NOTE, '').replace(/\n## Notes\n(?=\s*(\n## |$))/, '\n'); }
    if (!w.doc) { const c = cardOf(t, w.cardId) || { title: w.title, sub: '' }; w.doc = { md: bundleOf(t, c).length ? bundleFrom(t, c) : draftFrom(t, c, w), rev: 1, edits: [], at: now(t), planned: 1 }; }
    /* a brief written before cards carried a plan gets it: rewritten when nobody touched it yet, else the plan is added at the end */
    else if (!w.doc.planned) { w.doc.planned = 1; const c = cardOf(t, w.cardId), cp = c && !bundleOf(t, c).length ? (w.cardPlan || o.planOf?.(t, c)) : null;
      if (cp && !/\*\*Next:\*\*/.test(w.doc.md)) { if ((w.doc.rev || 1) <= 1 && !(w.doc.edits || []).length) w.doc.md = draftFrom(t, c, w); else w.doc.md = `${w.doc.md.trim()}\n\n## The plan\n${planMd(cp)}`; w.doc.measure = null; } }
    if (!w.doc.measure) { w.doc.plan ||= { ...planFromMd(w.doc.md), rev: w.doc.rev, how: 'read' }; applyMeasure(t, w, null); }
    return out(t, w);
  };
  const setDoc = (t, w, md, by, why) => {
    const before = w.doc.md; md = String(md || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
    if (md === before) return false;
    w.doc.md = md; w.doc.rev++; w.doc.at = now(t); w.updatedAt = now(t);
    w.doc.edits = [{ rev: w.doc.rev, by, why: why || null, at: now(t), changed: changedHeads(before, md) }, ...(w.doc.edits || [])].slice(0, 40);
    out(t, w); return true;
  };
  // which parts of the doc changed, named by their heading, so the chat can say "Edited the brief: Goal"
  const blocks = (md) => { const res = []; let h = 'Top'; for (const l of String(md).split('\n')) { const m = l.match(/^#{1,3}\s+(.*)/); if (m) { h = m[1].trim(); continue; } if (l.trim()) res.push([h, l.trim()]); } return res; };
  const changedHeads = (a, b) => { const A = new Set(blocks(a).map((x) => x.join('|'))), heads = new Set(); blocks(b).forEach((x) => { if (!A.has(x.join('|'))) heads.add(x[0]); }); const B = new Set(blocks(b).map((x) => x[0])); blocks(a).forEach((x) => { if (!B.has(x[0])) heads.add(x[0]); }); return [...heads].slice(0, 6); };

  // AI edits the whole document as asked, and says what it did. Mock: notes are appended.
  /* the brief is the source of truth for the plan. Every change to it (AI or typed) re-reads these fields
     from the brief's own words, and the card page, the measure and the launch all read them back. */
  /* what the brand's connected accounts say today, so the jam can answer "how did we do" and plan from real numbers */
  const accountLine = (t) => { const xs = acctRows(t).filter((e) => e.label && e.v != null).slice(0, 24); // DUMMY: simulated accounts are never quoted as numbers
    return xs.length ? `\n\nNumbers from ${t.member ? 'the brand’s' : 'the'} connected accounts, read today (quote these exactly; never invent others):\n${xs.map((e) => `- ${e.label}: ${e.v}${e.src ? ` (${e.src})` : ''}`).join('\n')}` : ''; };
  const PLAN_KEYS = ['option', 'change', 'audience', 'when', 'budget', 'owner', 'metric', 'target', 'window', 'guard', 'headline', 'body', 'button', 'why'];
  const PLAN_SCHEMA = { type: 'object', required: PLAN_KEYS, properties: { option: { type: 'string', description: 'The id of the option the brief goes with (from the list), or empty' }, change: { type: 'string', description: 'What changes, one line' }, audience: { type: 'string', description: 'Who it is for or where it runs' }, when: { type: 'string', description: 'When it starts or runs' }, budget: { type: 'string', description: 'Spend or budget' }, owner: { type: 'string', description: 'Who owns it' }, metric: { type: 'string', description: 'The number we measure' }, target: { type: 'string', description: 'The target for that number, exactly as the brief writes it' }, window: { type: 'string', description: 'When we read it, as a number of days (digits only)' }, guard: { type: 'string', description: 'When we stop' }, headline: { type: 'string', description: 'The exact headline customers will see, only if the brief contains finished customer-facing copy; never a question, an instruction or an internal note; else empty' }, body: { type: 'string', description: 'The exact customer-facing body or caption, same rule; else empty' }, button: { type: 'string', description: 'The customer-facing button text, if given; else empty' }, why: { type: 'string', description: 'Why we are doing this, one plain line for the team' } } };
  const planAsk = (t, c) => { const opts = (pageOf(t, c)?.options || []).map((o) => `${o.id}: ${o.name}`).join(' | ');
    return `Also return plan: what the brief now says for each field, copied from the brief's own words (empty when the brief doesn't say). For option, the id of the option the team has chosen, from: ${opts || '(no options)'}; only when the brief says it was chosen ("We go with…"). A recommendation or Brew pick is not a choice: leave option empty.`; };
  // offline: read the measure lines straight from the Markdown
  const planFromMd = (md) => { const L = String(md || '').split('\n'); const find = (re) => (L.find((l) => re.test(l)) || '');
    const val = (l) => l.replace(/\*\*/g, '').replace(/^\s*[-*]\s*/, '').replace(/^[^:]{1,40}:\s*/, '').trim();
    const tl = find(/\btarget\b|\bgoal\b/i), wl = find(/\bread (it )?on day\b|\bread after\b|\bwindow\b/i), gl = find(/\bstop (if|rule|when)\b|\bwe stop\b|\bpause\b/i), ml = find(/\bmetric\b|\bwe measure\b|\bhow we measure\b/i);
    const tv = tl.match(/(₹\s?[\d,]+(?:\.\d+)?\s*(?:lakh|cr|k)?|\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?x)/i);
    const wv = (wl || tl).match(/day\s*(\d{1,3})|(\d{1,3})\s*days/i);
    return { target: tv ? tv[1].replace(/\s+/g, '') : '', window: wv ? wv[1] || wv[2] : '', guard: gl ? val(gl) : '', metric: ml && !/^#/.test(ml) ? val(ml) : '' }; };
  // how we measure it, designed from the brief: AI's design when it gave one for this rev, else read from the Markdown
  const measureCtx = (t, w) => { const c = cardOf(t, w.cardId) || {}, opts = pageOf(t, c)?.options || [], o = opts.find((x) => x.id === w.decided) || opts.find((x) => x.pick) || opts[0];
    return { option: o?.measure || null, card: c.measure || w.measure || measureOf(t, c) || null }; };
  const applyMeasure = (t, w, spec) => {
    const ai = spec ? vetMeasure(spec, w.doc.md) : null;
    w.doc.measure = ai ? { ...ai, rev: w.doc.rev, how: 'ai' } : (() => { const x = measureFromMd(w.doc.md, w.doc.plan || {}, measureCtx(t, w)); return x ? { ...x, rev: w.doc.rev, how: 'read' } : null; })();
  };
  const applyPlan = (t, w, plan, how, spec) => {
    const c = cardOf(t, w.cardId) || {}, opts = pageOf(t, c)?.options || [];
    const p = Object.fromEntries(PLAN_KEYS.map((k) => [k, clean(String(plan?.[k] || '')).trim().slice(0, 240)]));
    if (p.window) p.window = (p.window.match(/\d{1,3}/) || [''])[0];
    if (p.option && !opts.some((o) => o.id === p.option)) p.option = '';
    w.doc.plan = { ...p, rev: w.doc.rev, how };
    applyMeasure(t, w, spec);
    // the brief going with another path moves the card's choice too
    // only a stated choice moves it ("we go with", "we chose"), never Brew's recommendation
    if (p.option && !/\b(we('| a)?re going with|we go with|going with|we chose|we picked|decided on)\b/i.test(w.doc.md || '')) p.option = '';
    if (p.option && p.option !== w.decided) { w.decided = p.option; if (w.cardId) { t.decided ||= {}; t.decided[w.cardId] = p.option; } }
  };
  const syncPlan = async (t, w) => {
    const c = cardOf(t, w.cardId) || { title: w.title, sub: '' };
    if (!isMock() && spend('text')) {
      try { const j = await claudeTool(`Read this brief for "${c.title}" at ${BN()} and pull out the plan.\n"""\n${w.doc.md}\n"""\n${planAsk(t, c)} Copy values exactly; never invent.\n${MEASURE_ASK}`, { type: 'object', required: ['plan', 'measure'], properties: { plan: PLAN_SCHEMA, measure: MEASURE_SCHEMA } }, 1600, 'brief_plan'); if (j?.plan) return applyPlan(t, w, j.plan, 'ai', j.measure); } catch (e) { log.warn('[brief plan]', e.message); }
    }
    applyPlan(t, w, { ...(w.doc.plan || {}), ...Object.fromEntries(Object.entries(planFromMd(w.doc.md)).filter(([, v]) => v)) }, 'read');
  };
  const SCHEMA = { type: 'object', required: ['reply', 'doc', 'next', 'plan', 'measure'], properties: { plan: PLAN_SCHEMA, measure: MEASURE_SCHEMA, reply: { type: 'string', description: 'Under 40 words, plain: what you changed, or the answer if nothing needed changing' }, next: { type: 'array', items: { type: 'string' }, description: 'Exactly 3 things the person might ask next, each 2 to 7 words, in their voice. Aim at the biggest gaps left in the brief after this edit; never repeat what was already asked or settled.' }, doc: { type: 'string', description: 'The WHOLE brief in Markdown after your edit (# title, ## headings, - bullets, **bold**)' } } };
  const appendNote = (md, who, text) => { const line = `- ${who === 'You' ? '' : who + ': '}${trim(text, 600)}`; return /\n## Notes\n/.test(md) ? md.replace(/(\n## Notes\n(?:- .*\n?)*)/, (m) => m.replace(/\n?$/, '\n') + line + '\n') : `${md}\n\n## Notes\n${line}`; };
  const edit = async (t, w, text, { who = 'You', mode = 'ask', from = '', sync = false } = {}) => {
    seed(t, w); const c = cardOf(t, w.cardId) || { title: w.title, sub: '', agent: w.agent };
    if (!isMock() && spend('text')) {
      try {
        const task = mode === 'add' ? `${who} picked this from ${from || 'the card'} to add to the brief. Work it into the right section in plain words (a new section only if none fits). Keep everything else as it is.\n"""${String(text).slice(0, 3000)}"""`
          : mode === 'fix' ? `${who} left comments on parts of the brief. Fix each one right where it points, exactly as asked (a comment with no words means make that part right and specific). Change only what the comments touch; keep the rest word for word.\n${String(text).slice(0, 4000)}`
          : mode === 'hear' ? `${who} said this in the jam. Fold any new decision, fact or answer into the brief where it belongs. If it adds nothing to the brief, return the brief unchanged.\n"""${String(text).slice(0, 3000)}"""`
          : `${who} asks: """${String(text).slice(0, 2000)}"""\nDo exactly what they ask. "Rewrite", "it's wrong", "all details are wrong" mean rewrite those parts properly, not a recap. If it's a question, answer it in the reply and change the brief only if the answer belongs in it.`;
        const multi = MULTI(t, c) || ((w.doc.md.match(/^## Plan \d/gm) || []).length > 1 ? `\nThis brief holds several SEPARATE plans ("## Plan N: ..." sections). Keep them separate and never merge them into one plan unless the person explicitly asks to merge or combine them.` : '');
        const j = await claudeTool(`${cardBrief({ ...c, agent: w.agent }, seatLine(t.viewer))}\n\nYou keep the jam brief for this card at ${BN()}: a free-flowing document the team, AI and the ShopOS team write together. The next people (the ShopOS team, an agency, a teammate) act from it, so it must be specific: who, what, where, when, how much, how we measure, who owns it.${multi}\n${promptBlock(t, w.agent === 'brew' ? 'creative' : w.agent)}${accountLine(t)}\nThe brand's fact sheet at the very top is reference for facts and numbers only: never copy its title, sections, tables or [k:…] tags into the jam brief.\nThe jam brief now:\n"""\n${w.doc.md}\n"""\n\n${task}\n\nRules: plain short sentences; keep the person's own words where they wrote them; numbers only from the facts list, the card or what people said; no internal jargon; Markdown only (# title once, ## headings, - bullets, **bold**). When someone asks for copy (a headline, caption, message, button, subject line) or to change it, write the finished words customers will see in a ## The copy section (- **Headline:** …, - **Body:** …, - **Button:** …), not a description of them, and fill them in the plan too. Return the whole brief. ${planAsk(t, c)}\n${MEASURE_ASK}`, SCHEMA, 4500, 'jam_doc');
        const md = unleak(clean(String(j.doc || '')).trim(), w.doc.md, w.title);
        if (md.length > 40) { const changed = setDoc(t, w, md, who === 'You' ? 'you' : who, mode === 'ask' ? String(text).slice(0, 80) : mode);
          if (j.plan) applyPlan(t, w, j.plan, 'ai', j.measure);
          if (Array.isArray(j.next)) { const nx = j.next.map((x) => clean(String(x)).replace(/[.]$/, '')).filter((x) => x && x.length <= 56); if (nx.length >= 2) w.doc.next = nx.slice(0, 3); } return { reply: clean(j.reply || ''), changed: changed ? w.doc.edits[0].changed : [], ai: true }; }
      } catch (e) { log.warn('[jam doc]', e.message); }
    }
    /* a quiet sync (the studio's package changed) is an instruction to the AI, never words for the brief: offline, the brief stays as it is */
    if (sync || mode === 'fix') return { reply: '', changed: [] }; /* comments stay open offline: never folded in as notes */
    if (mode === 'ask' && /\?\s*$/.test(String(text).trim())) return { reply: 'AI is offline right now, so I can’t answer that. Type the answer into the brief, or ask a teammate with @.', changed: [] };
    const changed = setDoc(t, w, appendNote(w.doc.md, who, text), who === 'You' ? 'you' : who, mode); if (changed) applyPlan(t, w, { ...(w.doc.plan || {}), ...Object.fromEntries(Object.entries(planFromMd(w.doc.md)).filter(([, v]) => v)) }, 'read');
    return { reply: mode === 'add' ? 'Added to the brief under Notes.' : 'Noted in the brief under Notes. (AI is offline, so I didn’t rewrite anything.)', changed: changed ? ['Notes'] : [] };
  };

  /* the brief follows the studio's package, which changes with every edit. It catches up when the brief is opened (the studio's
     Brief) and when it is sent or shared (doc/ship), never with an AI rewrite on every edit: an edit only notes what was asked
     (doc/sync lazy, no AI). w.doc.syncedHead is the change version the brief last followed */
  const headOfCh = (t, ch) => { const vs = versionsOf(t, ch.id); return vs.find((v) => v.id === ch.headVersionId) || vs[vs.length - 1] || null; };
  const fieldVal = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'object' && x ? Object.values(x).filter(Boolean).join(' / ') : x)).join('; ') : typeof v === 'object' && v ? Object.values(v).filter(Boolean).join(' / ') : v);
  const syncText = (t, w, ch) => {
    const lines = fieldsFor(ch.family, ch.action).map((f) => { const v = ch.pkg?.[f.k]; return v == null || v === '' || (Array.isArray(v) && !v.length) ? null : `${f.label}: ${fieldVal(v)}`; }).filter(Boolean);
    const d = ch.pkg?.draft?.remade ? ch.pkg.draft : null, asks = (w.doc?.asks || []).slice(-4);
    if (d) lines.push(`Format: ${d.as === 'video' ? 'a reel (vertical video)' : d.as === 'carousel' ? `a carousel of ${(d.slides || d.images || []).length || 'several'} slides` : 'a single picture'}${d.overlay ? `; words on it: ${d.overlay}` : ''}`, ...(d.slides || []).map((x, i) => `Slide ${i + 1}: ${x.text || ''}`), ...(d.script || []).map((x, i) => `Beat ${i + 1}: ${x.line || ''}`));
    if (ch.pkg?.video || d?.video) lines.push('It has its video made (in the assets).');
    return `The ${FAMILY_NAME[ch.family] || 'package'} is now v${headOfCh(t, ch)?.n || 1}${asks.length ? ` (asked: ${asks.map((x) => `“${x}”`).join('; ')})` : ''}. Make the brief match it exactly, keep everything else:\n${lines.join('\n')}`; };
  const behind = (t, w) => { const ch = changeOf(t, w), h = ch?.pkg ? headOfCh(t, ch)?.id : null; return !!h && w.doc?.syncedHead !== h; };
  const syncHead = async (t, w, { text = '' } = {}) => {
    const ch = changeOf(t, w); if (!ch?.pkg) return null; const head = headOfCh(t, ch)?.id || null;
    if (head && w.doc.syncedHead === head) return { changed: [], same: true };
    const r = await edit(t, w, text || syncText(t, w, ch), { who: 'Brew', mode: 'ask', sync: true });
    if (r?.ai) { w.doc.syncedHead = head; w.doc.asks = []; } /* offline nothing was rewritten: it stays behind and tries again */
    return r; };

  // teammates' and the ShopOS team's replies fold into the brief in the background
  const queue = new Map();
  const onSay = (t, w, m) => {
    // teammate and ShopOS-team messages are simulated in the prototype (DUMMY.md #5): only a real reply (m.real) may change the brief
    if (!w?.doc || !m || !m.real || !['colleague', 'brew'].includes(m.from)) return;
    if (/^(the brew team has it|taking so-|noted\.|got the brief)/i.test(m.body || '')) return;
    clearTimeout(queue.get(w.id));
    queue.set(w.id, setTimeout(() => { queue.delete(w.id); edit(t, w, m.body, { who: m.who || (m.from === 'brew' ? 'ShopOS team' : 'A teammate'), mode: 'hear' }).catch((e) => log.warn('[jam doc bg]', e.message)); }, 300));
  };

  const waText = (t, w) => `*Jam: ${w.title}*\n\n${seed(t, w).md.replace(/^#{1,3}\s+/gm, '*').replace(/^(\*[^\n*]+)$/gm, '$1*')}\n\nReply here. When we’re done, paste this chat back into Brew and the brief updates. (jam ${w.id})`;
  const finalDoc = (t, w) => { const d = seed(t, w); return { kind: d.kind, md: d.md, missing: d.missing, contributors: [...new Set((d.edits || []).map((e) => e.by).filter(Boolean))], at: now(t) }; };

  const routes = ({ on, W, say, move, notify, nextTicket, handoff, learn = null, toSlack = null, askMake = null }) => {
    const get = (t, id) => { const w = W(t, id); if (w) seed(t, w); return w; };
    on('GET', '/api/cards/:cid/brief', async (b, t, p, q) => { const c = cardOf(t, p.cid); return c ? { doc: preview(t, c, q?.get?.('decided') || null) } : { error: 'not found' }; });
    on('POST', '/api/work/:wid/jb', async (b, t, p) => { const w = get(t, p.wid); return w ? { work: w } : { error: 'not found' }; });
    // your own edit of the brief. A stale rev gets the current doc back instead of overwriting someone else.
    on('POST', '/api/work/:wid/doc', async (b, t, p) => {
      const w = get(t, p.wid); if (!w) return { error: 'not found' };
      if (b.rev != null && +b.rev !== w.doc.rev) return { stale: true, work: w };
      if (setDoc(t, w, String(b.md || ''), 'you', 'Your edit')) await syncPlan(t, w); return { work: w };
    });
    // ask AI to change the brief (or ask it something). One call: the chat reply and the edit.
    /* the studio changed the package: the brief follows it quietly (no chat message), so it is always the final version */
    on('POST', '/api/work/:wid/doc/sync', async (b, t, p) => {
      const w = get(t, p.wid); if (!w) return { error: 'not found' }; const text = String(b.text || '').trim().slice(0, 3000);
      /* lazy (every studio edit): only what was asked is noted, no AI; the brief catches up on open or send */
      if (b.lazy) { const said = String(b.said || '').replace(/\s+/g, ' ').trim().slice(0, 200); if (said) w.doc.asks = [...(w.doc.asks || []), said].slice(-6); return { work: w, behind: behind(t, w) }; }
      if (!changeOf(t, w)) { if (!text) return { error: 'empty' }; const r = await edit(t, w, text, { who: 'Brew', mode: 'ask', sync: true }).catch((e) => ({ error: e.message })); return { work: w, changed: r?.changed || [] }; }
      /* now (the Brief opened): one AI pass, only when the studio's head moved since the brief last followed it */
      const r = await syncHead(t, w, { text }).catch((e) => ({ error: e.message })); return { work: w, changed: r?.changed || [], same: !!r?.same };
    });
    on('POST', '/api/work/:wid/doc/ask', async (b, t, p) => {
      const w = get(t, p.wid); if (!w) return { error: 'not found' }; const text = String(b.text || '').trim(); if (!text) return { error: 'empty' };
      /* /update-brand-learnings (or a pasted call transcript in a fresh jam): Brew learns from it, the brief is left alone (brand-learnings.js) */
      const L = learn ? await learn(t, w, text).catch((e) => { log.warn('[learn]', e.message); return { said: null, reply: 'That didn’t go through, so nothing changed. Try again in a minute.' }; }) : null;
      if (L) { say(t, w, { from: 'me', body: L.said || text, learn: true }); say(t, w, { from: 'ai', who: 'Brew', body: L.reply, learn: true }); return { work: w, changed: [], learned: L.n ?? null }; } /* learn: not the jam's own ask (the board keeps asking what to make) */
      say(t, w, { from: 'me', body: text });
      /* "make it a reel": a paid image or video is proposed first, with Make it / Not now (feed-service propose) */
      const pd = askMake ? await askMake(t, w, text) : null; if (pd) return { work: w, changed: [], pending: pd };
      /* a question: one small grounded answer (the card, the brief, the facts, the connected numbers), checked, and the
         brief is not rewritten. Faster than re-writing the whole brief to answer it, and it never invents a result */
      /* "what's the evidence for this?": the card's own proof as the shield shows it, never the general answer and never a note in the brief (final QA pass 19 Oct, FEED-ARV-01) */
      if (EVIDENCE_ASK.test(text) && o.proofOf) { const pa = o.proofOf(t, w); if (pa) { say(t, w, { from: 'ai', who: AGENT[w.agent] || 'Brew', body: pa, edited: [], answer: true }); return { work: w, changed: [], answered: true }; } }
      if (isQuestion(text)) {
        const c = cardOf(t, w.cardId) || { title: w.title, sub: '', agent: w.agent }; let body = 'AI is offline right now, so I can’t answer that. Type the answer into the brief, or ask a teammate with @.';
        if (!isMock() && spend('text')) try { const a = await answerGrounded({ ai: (pr, sc, mx, tag) => claudeTool(pr, sc, mx, tag), question: text, who: AGENT[w.agent] || 'Brew',
          evidence: `${cardBrief({ ...c, agent: w.agent }, seatLine(t.viewer))}${accountLine(t) || '\n\nConnected accounts: none with results for this yet.'}\n\nThe jam brief:\n${w.doc.md}`,
          history: (w.thread || w.messages || []).slice(-6).map((m) => `${m.from === 'me' ? 'Them' : 'Brew'}: ${String(m.body || '').slice(0, 300)}`) }); body = clean(a.answer); } catch (e) { log.warn('[jam answer]', e.message); body = 'That didn’t go through, so nothing changed. Ask again in a minute.'; }
        say(t, w, { from: 'ai', who: AGENT[w.agent] || 'AI', body, edited: [], answer: true });
        return { work: w, changed: [], answered: true };
      }
      const r = await edit(t, w, text, { who: 'You', mode: 'ask' });
      say(t, w, { from: 'ai', who: AGENT[w.agent] || 'AI', body: r.reply || (r.changed.length ? 'Done.' : 'Nothing to change there.'), edited: r.changed });
      if (!['drafting', 'team', 'shared'].includes(w.stage)) move(t, w, 'drafting', null);
      return { work: w, changed: r.changed };
    });
    /* comments on the brief: select words in it, say what's wrong, and AI fixes every open comment in one pass (doc/fix).
       They live on the jam (w.doc.comments), so a teammate sees them too; a fixed comment leaves the list */
    const cmOpen = (w) => (w.doc.comments ||= []);
    on('POST', '/api/work/:wid/doc/comment', async (b, t, p) => {
      const w = get(t, p.wid); if (!w) return { error: 'not found' };
      if (b.remove) { w.doc.comments = cmOpen(w).filter((c) => c.id !== b.id); w.updatedAt = now(t); return { work: w }; }
      const quote = String(b.quote || '').replace(/\s+/g, ' ').trim().slice(0, 600), note = String(b.note || '').trim().slice(0, 1000);
      if (!quote && !note) return { error: 'empty' };
      cmOpen(w).push({ id: `cm${now(t).toString(36)}${Math.random().toString(36).slice(2, 5)}`, quote, note, by: o.meOf?.(t)?.name || 'You', at: now(t) });
      w.doc.comments = w.doc.comments.slice(-30); w.updatedAt = now(t); return { work: w };
    });
    on('POST', '/api/work/:wid/doc/fix', async (b, t, p) => {
      const w = get(t, p.wid); if (!w) return { error: 'not found' };
      const ids = Array.isArray(b.ids) && b.ids.length ? new Set(b.ids) : null, cms = cmOpen(w).filter((c) => !ids || ids.has(c.id));
      if (!cms.length) return { error: 'No comments to fix.', work: w };
      const text = cms.map((c, i) => `${i + 1}. ${c.quote ? `On “${c.quote}”: ` : ''}${c.note || 'Make this part right and specific.'}`).join('\n');
      const r = await edit(t, w, text, { who: 'You', mode: 'fix' }).catch((e) => ({ error: e.message }));
      if (!r?.ai) return { error: isMock() ? 'AI is offline right now, so the comments stay. Edit the brief yourself, or try again shortly.' : 'That didn’t go through, so the comments stay. Try again in a minute.', work: w };
      const done = new Set(cms.map((c) => c.id)); w.doc.comments = cmOpen(w).filter((c) => !done.has(c.id));
      say(t, w, { from: 'system', body: `AI fixed ${cms.length === 1 ? 'a comment' : `${cms.length} comments`} on the brief${r.changed.length ? `: ${r.changed.join(', ')}` : ''}.`, edited: r.changed });
      return { work: w, changed: r.changed, reply: r.reply, fixed: cms.length };
    });
    // a selection from the card, a move or the package, added to the brief
    on('POST', '/api/work/:wid/doc/add', async (b, t, p) => {
      const w = get(t, p.wid); if (!w) return { error: 'not found' }; const text = String(b.text || '').trim(); if (!text) return { error: 'empty' };
      const r = await edit(t, w, text, { who: 'You', mode: 'add', from: String(b.from || 'the card').slice(0, 80) });
      say(t, w, { from: 'system', body: `Added to the brief${b.from ? ` from ${String(b.from).slice(0, 80)}` : ''}${r.changed.length ? `: ${r.changed.join(', ')}` : ''}.`, edited: r.changed });
      return { work: w, changed: r.changed };
    });
    on('POST', '/api/work/:wid/jb/move', async (b, t, p) => {
      const w = get(t, p.wid); if (!w) return { error: 'not found' }; const to = b.to === 'slack' ? 'slack' : 'whatsapp';
      w.doc.moved = { to, at: now(t), channel: b.channel || null };
      if (b.decided !== undefined) w.decided = b.decided || null;
      // the full context goes with it: card, options, moves, brief, package and assets, both chats, and a link to all of it
      let text = waText(t, w), page = null;
      if (handoff) { try { const x = await handoff.build(t, w, { base: b.base }); text = handoff.text(x, to === 'slack' && toSlack ? 'slack-live' : to); page = x.links.page; } catch (e) { log.warn('[handoff]', e.message); } }
      /* a really connected Slack: the jam is posted to the channel, and its thread talks to this jam from now on */
      if (to === 'slack' && toSlack) {
        const r = await toSlack(t, w, { text, page, channel: b.channelId || null });
        if (r.error) { w.doc.moved = null; return { error: r.error, connect: !!r.connect }; }
        w.doc.moved = null; const ch = r.channelName || w.slack?.name || 'the channel';
        say(t, w, { from: 'system', body: `Posted to Slack (${ch}) with the full context and an Approve button. Replies in the thread land here and in the brief.` });
        return { work: w, text, page, posted: { channel: ch, ts: r.ts } };
      }
      say(t, w, { from: 'system', body: (to === 'whatsapp' ? 'The jam moved to WhatsApp' : `The jam moved to Slack${b.channel ? ' (' + b.channel + ')' : ''}`) + ` with the full context${page ? ` (${page})` : ''}. Paste the chat back here when you’re done.` });
      return { work: w, text, page };
    });
    // a WhatsApp or Slack chat pasted back: AI folds the decisions into the brief
    on('POST', '/api/work/:wid/jb/import', async (b, t, p) => {
      const w = get(t, p.wid); if (!w) return { error: 'not found' }; const text = String(b.text || '').trim(); if (text.length < 4) return { error: 'Paste the chat first' };
      const from = b.from || w.doc.moved?.to || 'chat', who = from === 'whatsapp' ? 'WhatsApp' : from === 'slack' ? 'Slack' : 'The pasted chat';
      const r = await edit(t, w, text, { who, mode: 'hear' }); w.doc.moved = null;
      say(t, w, { from: 'system', body: r.changed.length ? `The chat from ${who} updated the brief: ${r.changed.join(', ')}.` : `Nothing new for the brief in that chat.`, edited: r.changed });
      return { work: w, changed: r.changed };
    });
    /* Share the brief: the jam's one exit. The brief is frozen. To the brand's own team it is copied (text + a link to the full
       read-only brief); to the ShopOS team it is SENT: the whole brief goes to their inbox (jam-mail.js briefSent) and gets a
       tracked status (brief-status.js) the ShopOS team moves on. Missing items ask once (force), never block */
    on('POST', '/api/work/:wid/doc/ship', async (b, t, p) => {
      const w = get(t, p.wid); if (!w) return { error: 'not found' };
      /* the brief that goes is the version on the stage: if the studio moved on since the brief last followed it, it catches up
         first (one AI pass), so the frozen brief, the email and the handoff carry the same version, its reel and its slides */
      if (behind(t, w)) await syncHead(t, w).catch((e) => log.warn('[brief sync at send]', e.message));
      if (w.doc.missing.length && !b.force) return { needs: w.doc.missing, work: w };
      if (b.decided !== undefined) w.decided = b.decided || null;
      const to = b.to === 'team' ? 'team' : 'shopos', prev = w.jamBrief || null;
      w.jamBrief = finalDoc(t, w); w.doc.shippedAt = now(t); w.jamBrief.sharedAt = now(t); w.jamBrief.to = to; w.jamBrief.spec = w.doc.spec || [];
      /* a brief already with the ShopOS team stays theirs: a copy for your own team is built and copied, then the ShopOS brief is put back */
      const teamOfShopos = to === 'team' && prev?.status && prev.to !== 'team';
      /* the same brief, already emailed in the last ten minutes and not yet touched by the team, is not emailed twice */
      const resend = to === 'shopos' && prev?.status === 'sent' && prev.to !== 'team' && prev.sentMd && prev.sentMd === w.jamBrief.md && now(t) - (prev.sentAt || 0) < 10 * 60e3;
      if (to === 'shopos' && resend) Object.assign(w.jamBrief, { status: prev.status, statusAt: prev.statusAt, history: prev.history || [], sender: prev.sender, sentMd: prev.sentMd, sentAt: prev.sentAt });
      else if (to === 'shopos') { w.jamBrief.history = prev?.history || []; startStatus(w.jamBrief, { by: o.meOf?.(t) || null, at: now(t) }); }
      if (!w.ticket) w.ticket = await nextTicket(t);
      let share = null;
      if (handoff) { try { const x = await handoff.build(t, w, { base: b.base }); w.jamBrief.context = x; share = { url: x.links.page, text: handoff.text(x, to === 'shopos' ? 'brew' : 'whatsapp') }; w.jamBrief.handoff = share; } catch (e) { log.warn('[handoff]', e.message); } }
      const open = w.jamBrief.missing.length ? `. Still open: ${w.jamBrief.missing.join(', ').toLowerCase()}` : '';
      if (to === 'shopos' && resend) return { work: w, share, status: w.jamBrief.status || null, already: true, emailed: true };
      let emailed = false;
      if (to === 'shopos') {
        const sent = o.onBriefSent ? await o.onBriefSent(t, w).catch((e) => { log.warn('[brief sent]', e.message); return false; }) : (o.onShopos?.(t, w, { why: 'shared a brief with the ShopOS team', text: '' }), false);
        if (sent) Object.assign(w.jamBrief, { sentMd: w.jamBrief.md, sentAt: now(t) }); /* only what really went out counts as sent for the double-tap check */
        else { /* nothing went out (the demo site, or the mail failed): it is not "sent", so no status, no stamp, no pill; it stays ready to paste */
          const h = w.jamBrief.history || []; if (h[0]?.s === 'sent') h.shift();
          const keep = prev?.status && prev.to !== 'team'; w.jamBrief.status = keep ? prev.status : null; w.jamBrief.statusAt = keep ? prev.statusAt : null; }
        emailed = !!sent;
        say(t, w, { from: 'system', body: `Brief ${w.ticket} ${sent ? 'sent to' : 'ready for'} the ShopOS team: the brief, deliverables, assets, rules and when it is done${open}. ${sent ? 'You’ll see each step here as they pick it up.' : 'Paste it where they work.'}` });
        move(t, w, 'shared', `${w.ticket}: brief ${sent ? 'sent to' : 'shared with'} the ShopOS team`);
      } else {
        say(t, w, { from: 'system', body: `Brief ${w.ticket} copied for your team: the card, options, plan, assets and both chats${open}. Paste it where they work.` });
        if (teamOfShopos) w.jamBrief = { ...prev, teamCopyAt: now(t) }; else move(t, w, 'shared', `${w.ticket}: brief shared with your team`);
      }
      return { work: w, share, status: w.jamBrief.status || null, emailed };
    });
    /* the ShopOS team moves a sent brief on (staff only: SquareUp's people, auth.isAdmin). It writes a line in the jam and the
       person who sent the brief gets an email (never on the demo site) */
    on('POST', '/api/work/:wid/brief/status', async (b, t, p) => {
      const w = get(t, p.wid); if (!w) return { error: 'not found' };
      const me = o.staffOf?.(t); if (!me) return { status: 403, error: 'Only the ShopOS team moves a brief on.' };
      const to = String(b.status || ''), note = String(b.note || '').trim().slice(0, 2000);
      const r = moveStatus(w.jamBrief, to, { by: me, note, at: now(t) }); if (r.error) return { error: r.error, work: w };
      /* a status with a note is a real reply (it folds into the brief, jam-brief onSay); a bare status changes nothing in it */
      say(t, w, { from: 'brew', who: me.name || 'ShopOS team', real: !!note, body: `${LABEL[to]}${note ? `: ${note}` : '.'}`, status: to });
      notify(t, w, to === 'needs_info' ? `${w.ticket || 'Brief'}: the ShopOS team needs something from you` : `${w.ticket || 'Brief'}: ${LABEL[to].toLowerCase()} by the ShopOS team`, to === 'needs_info' ? 'needs_you' : 'update');
      o.onBriefStatus?.(t, w, { by: me, status: to, label: LABEL[to], note });
      return { work: w, status: w.jamBrief.status, history: w.jamBrief.history };
    });
  };

  return { seed, onSay, routes, finalDoc, waText, preview, missingOf, edit, behind, syncHead };
}
