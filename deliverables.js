// Every deliverable a brand could ask for (data/deliverables.json, built from docs/deliverables-catalog.txt by
// tools/deliverables.mjs). Each one can be added to any card under "+" and opens as a jam: a row with an action opens as that
// action (Instagram post, Welcome flow…), named as the row; a planning row (no action yet) is written as one of the families
// every jam already draws, checks and briefs, and a person makes and ships it from the brief. Brew never posts, sends or spends.
import fs from 'node:fs';

const DATA = JSON.parse(fs.readFileSync(new URL('./data/deliverables.json', import.meta.url), 'utf8'));
export const DELIVERABLES = DATA.rows.map((r) => (/^IG\b/.test(r.name) ? { ...r, name: r.name.replace(/^IG\b/, 'Instagram') } : r)); /* "IG feed post" reads "Instagram feed post" (QV P2-11, 26 Oct); its id stays, so saved jams keep their row */
const BY_ID = new Map(DELIVERABLES.map((r) => [r.id, r]));
const BY_KEY = new Map(DELIVERABLES.filter((r) => r.key).map((r) => [r.key, r]));
export const dlOf = (id) => BY_ID.get(String(id || '')) || null;
/* the row a planning action key belongs to ("creative.p_trial_reel") */
export const dlOfKey = (key) => BY_KEY.get(String(key || '')) || null;
/* the action a row opens as */
export const dlAction = (r) => r ? r.action || r.key : null;
/* what the writer is told the piece is: the catalogue's own words, then its rules */
export const dlSpec = (r) => r ? `${r.name} (${r.platform}): ${r.what}. Rules it must meet: ${r.checks}. Made and shipped by: ${r.who}. Hand-off: ${r.handoff}.` : '';

/* what a planning deliverable is, in one word, beside where it goes ("End screen and cards plan on YouTube · Plan") */
const LAYOUT_NAME = { pic: 'Picture', set: 'Several pictures', reel: 'Video', msg: 'Message', mail: 'Email', page: 'Page', post: 'Community post', acct: 'Account change', check: 'Checklist', brief: 'Brief' };
const NOUN = { pic: 'Picture', set: 'Set of pictures', reel: 'Video', post: 'Post', msg: 'Message', mail: 'Email', page: 'Page', check: 'Plan', acct: 'Account change', brief: 'Brief' };
/* who makes it, in a sentence: "Designer" → "your designer", "Social / CRM (ManyChat)" → "your social or CRM team" (QV P2-4, 26 Oct:
   "made and shipped by Designer") */
const TEAMS = /^(?:social|crm|support|community|content|marketing|performance|events|sales|ops|pr|marketplace|seo|legal|dev|brand)$/i;
export const whoOf = (x) => { const s = String(x || '').replace(/\s*\([^)]*\)/g, '').trim(); if (!s) return 'your team'; if (/^whoever\b/i.test(s)) return s.charAt(0).toLowerCase() + s.slice(1);
  const one = (w) => { w = w.trim(); const l = w.split(' ').map((y) => (/^[A-Z]{2,}$/.test(y) ? y : y.toLowerCase())).join(' '); return TEAMS.test(w) ? `${l} team` : l; };
  return `your ${s.split(/\s*\+\s*/).map((a) => a.split(/\s*\/\s*|\s+or\s+/i).map(one).join(' or ')).join(' and ')}`.replace(/\b(\w+) team or (\w+) team\b/g, '$1 or $2 team'); };
/* the planning rows as actions and families, merged into ACTIONS and FAMILY_OF where those are defined */
export const planActions = () => { const out = {};
  for (const r of DELIVERABLES) if (r.key) (out[r.agent] ||= {})[r.key.split('.')[1]] = { label: r.name, target: { conn: null, object: NOUN[r.layout], name: r.platform === 'Other' ? null : r.platform }, money: false,
    jam: `Planned in Brew; made and shipped by ${whoOf(r.who)}`, rollback: 'Nothing ships until a person ships it', scope: [[1, `One ${r.name.charAt(0).toLowerCase()}${r.name.slice(1)}`]], preview: r.preview, manual: true, plan: true };
  return out; };
export const planFamilies = () => Object.fromEntries(DELIVERABLES.filter((r) => r.key).map((r) => [r.key.split('.')[1], r.family]));
/* the composer's chips for a planning deliverable, by its layout (each action has 3 or more of its own) */
const LAYOUT_CHIPS = { pic: ['Fewer words on it', 'Hinglish version', 'Another angle'], set: ['Fewer slides', 'Add a proof slide', 'Hinglish version'], reel: ['Stronger hook', 'Cut it to 15 seconds', 'Hindi voice-over'],
  post: ['Shorter', 'Warmer', 'End with a question'], msg: ['Hinglish', 'Shorter', 'Add the opt-out line'], mail: ['Shorter subject line', 'Warmer opening', 'One clear ask'], page: ['Shorter', 'Lead with the benefit', 'Add a FAQ'],
  check: ['Fewer steps', 'Name an owner for each step', 'Say how we know it worked'], acct: ['A smaller first step', 'Add the undo', 'Name the exact settings'], brief: ['Tighter deadline', 'Add references', 'Add the budget'] };
export const planChips = () => Object.fromEntries(DELIVERABLES.filter((r) => r.key).map((r) => [r.key.split('.')[1], LAYOUT_CHIPS[r.layout]]));
/* the draft a planning deliverable opens on when no AI writer is coming: its own catalogue words, never another family's sample
   (a WhatsApp Community plan opened as "Store and ad tracking … Before and after, the same number": 26 Oct) */
const partsOf = (s) => { const x = String(s || ''), m = /^[^:]{3,80}:\s+(.+)$/.exec(x); /* "Cover set in the brand kit: Reviews, How to use, Ingredients, Offers" is four parts */
  if (m && m[1].split(/,\s+/).length >= 3) return m[1].split(/,\s+|\s+and\s+/).map((y) => y.trim().replace(/[.]$/, '')).filter((y) => y.length > 1).slice(0, 8);
  return x.split(/;\s*|:\s+|,\s+(?=[a-z])|\.\s+/).map((y) => y.trim().replace(/[.]$/, '')).filter((y) => y.length > 2).slice(0, 6); };
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
export const planMock = (r, family, pkg = {}, c = {}) => { const parts = partsOf(r.what), on = c.title ? ` for “${c.title}”` : '';
  if (family === 'setup') return { tool: r.platform === 'Other' ? r.who : r.platform, what: `${r.name}${on}: ${r.what}`, steps: parts.length ? parts.map(cap) : [r.what], verify: `${r.who} checks it against its rules before it goes live`, customerSees: '' }; /* the rules themselves go to the brief's Must-haves */
  if (family === 'brief') return { ...pkg, title: `${r.name}${on}`, deliverables: [r.what, `Hand over: ${r.handoff}`], ...(parts.length >= 2 ? { scenes: parts.slice(0, 5).map((x) => ({ shot: cap(x), line: '' })) } : {}), talent: '', location: '', deadline: '' };
  if (family === 'post') return { ...pkg, platform: `${r.platform} · ${r.name}` };
  return pkg; };
export const planSpecs = () => Object.fromEntries(DELIVERABLES.filter((r) => r.key).map((r) => [r.key.split('.')[1], dlSpec(r)]));

/* the "+" list for a card: every deliverable not already open on it, in the catalogue's order, each with its group for the picker */
export const dlMenu = (open = []) => { const have = new Set(open.filter(Boolean));
  return DELIVERABLES.filter((r) => !have.has(r.id)).map((r) => ({ id: r.id, label: r.name, group: cap(r.section.replace(/^Social: /, '')), platform: r.platform, layoutName: LAYOUT_NAME[r.layout] || '', common: r.tier === 'C', plan: !r.action })); };
