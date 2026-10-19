// A brief sent to the ShopOS team, and where it is with them (UI2 "Send brief" and the top bar's "N with the team" pill).
// Send brief (jam-brief.js doc/ship, to=shopos) emails the whole brief to SHOPOS_EMAIL and sets w.jamBrief.status = 'sent'.
// The ShopOS team (staff: auth.isAdmin, shopos.ai / joinsquareup.com) moves it on with POST /api/work/:wid/brief/status:
//   sent → received → in_progress → delivered, or needs_info (they need something from the brand) and back to in_progress.
// Each move is kept in w.jamBrief.history ({ s, at, by, note }) and the person who sent the brief gets an email.
// A brief shared with the brand's own team (to=team) is copied, never sent, and has no status.

export const STATUSES = ['sent', 'received', 'in_progress', 'needs_info', 'delivered'];
export const LABEL = { sent: 'Sent', received: 'Received', in_progress: 'In progress', needs_info: 'Needs info from you', delivered: 'Delivered' };
/* what may follow what. Staff can also re-open a delivered brief (back to in_progress) when the brand asks for a change */
const NEXT = { sent: ['received', 'in_progress', 'needs_info', 'delivered'], received: ['in_progress', 'needs_info', 'delivered'], in_progress: ['needs_info', 'delivered'], needs_info: ['in_progress', 'delivered'], delivered: ['in_progress'] };
export const canMove = (from, to) => STATUSES.includes(to) && (NEXT[from] || []).includes(to);

/* a brief just sent: status sent, history starts */
export function startStatus(jb, { by = null, at = Date.now() } = {}) {
  jb.status = 'sent'; jb.sender = by ? { email: by.email || null, name: by.name || null } : jb.sender || null;
  jb.history = [{ s: 'sent', at, by: by?.email || null, note: '' }, ...(jb.history || [])].slice(0, 40);
  jb.statusAt = at; return jb;
}
/* a staff move: { error } when it is not allowed, else the history line it added */
export function moveStatus(jb, to, { by = null, note = '', at = Date.now() } = {}) {
  if (!jb?.status) return { error: 'This brief was not sent to the ShopOS team.' };
  if (!STATUSES.includes(to)) return { error: `Status is one of: ${STATUSES.join(', ')}.` };
  if (to === jb.status && !note) return { error: `It is already ${LABEL[to].toLowerCase()}.` };
  if (to !== jb.status && !canMove(jb.status, to)) return { error: `A brief that is ${LABEL[jb.status].toLowerCase()} can’t go to ${LABEL[to].toLowerCase()}.` };
  if (to === 'needs_info' && !String(note || '').trim()) return { error: 'Say what you need from them.' };
  const line = { s: to, at, by: by?.email || null, name: by?.name || null, note: String(note || '').trim().slice(0, 2000) };
  jb.status = to; jb.statusAt = at; jb.history = [line, ...(jb.history || [])].slice(0, 40);
  return { line };
}
/* the briefs still with the ShopOS team (sent and not delivered), for the top bar's pill */
export function withTeam(work = []) {
  const items = work.filter((w) => !w.archived && !w.discarded && w.jamBrief?.status && w.jamBrief.status !== 'delivered')
    .map((w) => ({ wid: w.id, title: w.title, ticket: w.ticket || null, status: w.jamBrief.status, label: LABEL[w.jamBrief.status], sentAt: w.jamBrief.sharedAt || null /* "Sent 4:12 pm" on the pill */, at: w.jamBrief.statusAt || w.jamBrief.sharedAt || null }))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  return { n: items.length, needsInfo: items.filter((x) => x.status === 'needs_info').length, items };
}

/* the parts of the full brief email, from the handoff context (handoff.js build) and the frozen brief (jam-brief.js finalDoc):
   deliverables, assets (links and images), rules, done-when and where. Every part is plain text; the email escapes it */
export function briefParts(x = {}, jb = {}, { banned = [] } = {}) {
  const spec = Object.fromEntries((jb.spec || x.spec || []).filter((s) => s.value).map((s) => [s.label, s.value]));
  const pkg = x.pkg || null;
  const deliverables = [];
  if (pkg) deliverables.push(`${pkg.action} on ${pkg.target}${pkg.version ? ` (v${pkg.version})` : ''}`);
  (pkg?.fields || []).filter((f) => f.pub && f.value).slice(0, 6).forEach((f) => deliverables.push(`${f.label}: ${f.value}`));
  if (spec.Deliverables) deliverables.push(spec.Deliverables);
  if (!deliverables.length && x.decided?.name) deliverables.push(`${x.decided.name}${x.decided.effect ? `: ${x.decided.effect}` : ''}`);
  const cur = (x.versions || []).find((v) => v.current);
  if (!deliverables.length && cur?.title) deliverables.push(x.card?.theirs && cur.n === 1 ? x.card.make || 'Our version of the rival’s ad' : `${cur.title}${cur.sub ? `: ${cur.sub}` : ''}`); /* v1 of a rival card is their ad, not ours */
  const seen = new Set(), assets = [];
  const add = (label, url, image) => { if (!url || seen.has(url)) return; seen.add(url); assets.push({ label, url, image: !!image }); };
  /* a clip (a reel, a short video) goes as a link to the file: an email can't play it, but it must never be left out */
  (pkg?.assets || []).forEach((a) => (a.kind === 'image' ? add(a.label, a.url, true) : a.kind === 'link' || a.kind === 'video' ? add(a.kind === 'video' ? `${a.label} (video)` : a.label, a.url, false) : null));
  if (cur?.image && !pkg) add('Current version', cur.image, true); /* with a package its assets are the version on the stage; the jam's own picture may be an older one */
  (x.card?.images || []).slice(0, 3).forEach((u) => add('From the card', u, true));
  if (x.card?.link) add('The card’s source', x.card.link, false);
  const rules = [];
  if (x.card?.watch) rules.push(x.card.watch);
  if (banned.length) rules.push(`Never use these claim words: ${banned.join(', ')}.`);
  (pkg?.checks || []).filter((c) => !c.done).slice(0, 4).forEach((c) => rules.push(`Check: ${c.text}`));
  const doneWhen = [];
  const m = x.measure;
  const fmt = (v) => (/^(₹|\$|£|€|[ACS]\$)$/.test(m.unit || '') ? `${m.unit}${v}` : m.unit === '%' ? `${v}%` : `${v}${m.unit && m.unit !== 'x' ? ` ${m.unit.trim()}` : ''}`);
  if (m?.metric) doneWhen.push(`${m.metric}${m.target != null && m.target !== '' ? `: target ${fmt(m.target)}` : ''}${m.window ? `, read after ${m.window} days` : ''}`);
  else if (spec['How we measure it']) doneWhen.push(spec['How we measure it']);
  if (spec.When) doneWhen.push(`When: ${spec.When}`);
  (jb.missing || []).length && doneWhen.push(`Still open in the brief: ${jb.missing.join(', ').toLowerCase()}`);
  const where = pkg?.target || spec['Where it runs'] || spec['Which pages'] || spec['Which campaigns'] || '';
  return { deliverables, assets: assets.slice(0, 10), rules, doneWhen, where };
}

/* the brief's Markdown as email-safe HTML: # and ## headings, - bullets and **bold** only, everything escaped */
export function mdToEmailHtml(md, { esc, p, FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif` }) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const out = []; let list = [];
  const flush = () => { if (list.length) out.push(`<ul style="margin:0 0 14px;padding:0 0 0 20px;font:15px/1.6 ${FONT};color:#333">${list.map((l) => `<li style="margin:0 0 4px">${inline(l)}</li>`).join('')}</ul>`); list = []; };
  for (const raw of String(md || '').split('\n')) {
    const l = raw.trimEnd();
    if (!l.trim()) { flush(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(l); if (h) { flush(); if (h[1].length === 1) continue; /* the title is the email's own title */ out.push(`<h2 style="margin:18px 0 8px;font:700 16px/1.35 ${FONT};color:#111">${inline(h[2])}</h2>`); continue; }
    const b = /^\s*(?:[-*]|\d+[.)])\s+(.*)$/.exec(l); if (b) { list.push(b[1]); continue; }
    flush(); out.push(p(inline(l)));
  }
  flush(); return out.join('');
}
