import { B } from './brand-ctx.js';
// The handoff: everything about a jam, in one place, for whoever picks it up outside the product
// (a WhatsApp group, a Slack channel, the ShopOS team shipping it). Card details, the options and what was
// chosen, what the moves say, the brief, every version, the remix package with its assets, the jam chat,
// the studio chat, open questions and how it's measured.
// - build(t, w): the context object (always the latest state)
// - /h/<token>?full=1: a read-only page with all of it (signed link, no login), rendered by html(ctx); /h/<token> opens the jam
// - text(ctx): the WhatsApp/Slack message, a full summary plus the link to the page
import crypto from 'node:crypto';

/* links are signed with HANDOFF_SECRET; links signed before it was set (with the Anthropic key) still open, so rotating the
   Anthropic key no longer breaks shared briefs once HANDOFF_SECRET is set */
/* 'local' (a public key) only signs on a laptop: on Cloud Run it would let anyone forge a link */
const KEYS = [...new Set([process.env.HANDOFF_SECRET, process.env.ANTHROPIC_API_KEY, process.env.K_SERVICE ? null : 'local'].filter(Boolean))].map((k) => crypto.createHash('sha256').update('brew-handoff:' + k).digest('hex'));
const signWith = (key, tid, wid) => crypto.createHmac('sha256', key).update(`${tid}/${wid}`).digest('base64url').slice(0, 12);
const sign = (tid, wid) => signWith(KEYS[0], tid, wid);
const signed = (sig, tid, wid) => typeof sig === 'string' && KEYS.some((k) => { const want = Buffer.from(signWith(k, tid, wid)), got = Buffer.from(sig); return want.length === got.length && crypto.timingSafeEqual(want, got); });
const optMeasure = (m) => `${m.metric}${m.where ? ` (${m.where})` : ''}, ${m.target || 'target set with you before go-live'}, read on day ${m.window}${m.guard ? `. Stop if: ${m.guard}` : ''}`;
export const handoffPath = (t, w) => `/h/${t.id}~${w.id}~${sign(t.id, w.id)}`;
/* the jam itself, as the app routes it: <brand>#remix=<card>/<change> opens this card's studio on this change, the latest
   version and state; the share token opens the same workspace. /h/<token> (the old read-only page) now redirects here */
export const jamPath = (t, w, chId) => {
  const slug = t.brandId && t.brandId !== 'brew-sample' ? t.brandId : '', tok = `&s=${shareToken(t.id, w.id)}`;
  if (!w.cardId || !t.cards?.get?.(w.cardId)) return `/${slug}#jam=${w.id}${tok}`;
  const mine = (c) => c && c.cardId === w.cardId, chs = Object.values(t.changes || {}).filter(mine);
  const ch = [t.changes?.[chId], t.changes?.[w.changeId]].find(mine) || chs.find((c) => c.workId === w.id) || chs.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
  return `/${slug}#remix=${encodeURIComponent(w.cardId)}${ch ? `/${ch.id}` : ''}${tok}`;
};
// a share token opens the same workspace (the same live state) in another browser. Anyone with it can look; signing in
// lets them take part in that one jam (wid), never the brand's whole team. Old tokens (no jam) only let people look.
export const shareToken = (tid, wid = null) => wid ? `${tid}~${wid}~${sign(tid, `share:${wid}`)}` : `${tid}~${sign(tid, 'share')}`;
export const parseShare = (tok) => { const p = String(tok || '').split('~');
  if (p.length === 3) { const [tid, wid, sig] = p; return tid && wid && signed(sig, tid, `share:${wid}`) ? { tid, wid } : null; }
  const [tid, sig] = p; return tid && sig && signed(sig, tid, 'share') ? { tid, wid: null } : null; };
export const parseToken = (tok) => { const [tid, wid, sig] = String(tok || '').split('~'); return tid && wid && sig && signed(sig, tid, wid) ? { tid, wid } : null; };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STAGE = { drafting: 'Drafting', team: 'With the team', brew: 'With the ShopOS team', needs_you: 'Needs your yes', ready: 'Ready to ship', deploying: 'Shipping', measuring: 'Live, measuring', result: 'Result in' };
const KIND = { report: 'Report', idea: 'Idea', decision: 'Decision', competitor: 'Competitor watch' };
// keep line breaks, cut at a line end near n characters
const clipLines = (s, n) => { const out = []; let len = 0; for (const l of String(s || '').split('\n')) { if (!l.trim()) continue; if (len + l.length > n) { out.push('…'); break; } out.push(l); len += l.length + 1; } return out.join('\n'); };
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };

export function createHandoff({ RMX, pageOf, fillCard, AGENT = {}, SEED = {}, base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com' }) {
  const abs = (u, b = base) => !u ? '' : /^https?:/.test(u) ? u : `${b.replace(/\/$/, '')}/${String(u).replace(/^\/+/, '')}`;

  const build = async (t, w, opts = {}) => {
    const b = opts.base || base;
    const raw = t.cards.get(w.cardId), c = raw ? fillCard(raw, t) : { title: w.title, sub: (w.versions || []).slice(-1)[0]?.sub || '', agent: w.agent };
    const page = raw ? await pageOf(t, c).catch(() => null) : null;
    const decided = opts.decided || w.decided || null;
    const ch = w.changeId && t.changes?.[w.changeId]; const pkg = ch && RMX?.packageOf ? RMX.packageOf(t, ch) : null;
    if (pkg) pkg.assets = pkg.assets.map((a) => a.url ? { ...a, url: abs(a.url, b) } : a);
    const m = w.measure || c.measure || null;
    const who = (x) => x.from === 'me' ? 'You' : x.from === 'ai' ? (x.who || AGENT[w.agent] || 'AI') : x.from === 'brew' ? (x.who ? `${x.who} (Brew)` : 'ShopOS team') : x.from === 'colleague' ? (x.who || 'Teammate') : 'Brew';
    return {
      id: w.id, title: w.title || c.title, ticket: w.ticket || null, stage: STAGE[w.stage] || w.stage, with: w.with?.name || null,
      links: { jam: abs(jamPath(t, w, opts.changeId), b), page: abs(`${handoffPath(t, w)}?full=1`, b), studio: pkg ? abs(pkg.studio, b) : null },
      brand: SEED.brand?.name || 'the brand', mark: SEED.brand?.mark || null,
      card: { title: c.title, sub: c.sub, agent: AGENT[c.agent] || 'Brew', type: KIND[c.type] || c.type || '', rows: c.rows || [], src: c.src || '', link: c.link || null,
        images: (c.images || []).filter((u) => !/mito[23]/.test(u)).map((u) => abs(u, b)), how: c.detail?.how || [], why: c.detail?.why || [], watch: c.detail?.watch || '' },
      page: page ? { lead: page.lead, reason: page.reason, follows: page.follows || [], moves: page.moves || [],
        options: page.options.map((o) => ({ ...o, chosen: decided ? (decided.id || decided) === o.id : false })) } : null,
      decided: decided && page ? page.options.find((o) => o.id === (decided.id || decided)) || null : null,
      brief: w.doc ? { kind: w.doc.kind, md: w.doc.md, missing: w.doc.missing || [] } : null,
      versions: (w.versions || []).map((v) => ({ n: v.n, title: v.title, sub: v.sub, by: v.who || v.by, note: v.note || '', image: v.images?.[0] ? abs(v.images[0], b) : null, current: v.n === w.current })),
      pkg, jam: (w.thread || []).filter((x) => x.body && x.id !== 'tmp' && !x.dummy && !(['colleague', 'brew'].includes(x.from) && !x.real)).map((x) => ({ who: who(x), text: x.body, at: x.at, system: x.from === 'system' })),
      questions: (w.plan?.questions || []).map((q) => ({ q: q.q, a: q.answer && !/^teammate:/.test(q.by || '') && q.by !== 'brew' ? q.answer : null })),
      measure: m ? { metric: m.metric, baseline: m.connected ? m.baseline : null, target: m.target, unit: m.unit, window: m.window, watch: m.watch || [], attribution: m.attribution || '' } : null,
      now: nowOf(w),
      at: Date.now()
    };
  };

  // where the work is right now, in one line: being drafted, decided, or the brief shared (the jam ends there)
  const nowOf = (w) => {
    if (w.stage === 'shared' || w.jamBrief?.sharedAt) return { phase: 'shared', head: 'Brief shared', line: w.ticket ? `Ticket ${w.ticket}` : `v${w.current} is the final version`, extra: '' };
    if (w.stage === 'team') return { phase: 'jamming', head: `With ${w.with?.name || 'the team'}`, line: '', extra: '' };
    return { phase: w.decided ? 'decided' : 'fresh', head: w.decided ? 'Decided, being drafted' : 'Being drafted', line: `v${w.current} of ${(w.versions || []).length}`, extra: '' }; };

  const fmt = (m, v) => v == null ? '—' : /^(₹|\$|£|€|[ACS]\$)$/.test(m.unit || '') ? `${m.unit}${Math.round(v)}` : m.unit === '%' ? `${(+v).toFixed(1)}%` : `${v}${m.unit || ''}`;

  // WhatsApp and Slack both read *bold* and _italic_. A full summary, then the link to everything.
  const text = (x, to = 'whatsapp') => {
    const L = [];
    L.push(`*🎛️ Jam: ${x.title}*${x.ticket ? ` (${x.ticket})` : ''}`, `_${[x.brand, 'Brew', x.card.agent !== 'Brew' && x.card.agent, x.card.type, x.stage].filter(Boolean).join(' · ')}_`, '');
    if (x.now) L.push(`*Where it is now: ${x.now.head}*`, ...[x.now.line, x.now.extra].filter(Boolean), '');
    L.push(`*The card*`, x.card.title, clip(x.card.sub, 220));
    if (x.card.rows.length) L.push(x.card.rows.slice(0, 5).map(([k, v]) => `• ${k}: ${v}`).join('\n'));
    if (x.page) {
      L.push('', x.decided ? `*We’re going with:* ${x.decided.name}` : '*The options*');
      if (x.decided) L.push(clip(x.decided.says, 200), `What changes: ${clip(x.decided.effect, 220)}`, ...(x.decided.measure ? [`How we’ll know: ${optMeasure(x.decided.measure)}`] : []));
      else x.page.options.forEach((o, i) => L.push(`${i + 1}. ${o.name}${o.pick ? ' ⭐ Brew pick' : ''}: ${clip(o.effect || o.says, 140)}`));
      if (x.page.reason) L.push(`_Why:_ ${clip(x.page.reason, 240)}`);
      if (x.page.moves.length) L.push(`_From ${x.page.moves.map((mv) => `Move ${String(mv.n).padStart(2, '0')}`).join(', ')}:_ ${clip(x.page.moves[0].says || x.page.moves[0].plain, 180)}`);
    }
    if (x.brief?.md) L.push('', '*The brief*', clipLines(x.brief.md.replace(/^#\s+.*$/m, '').replace(/^#{2,3}\s+(.*)$/gm, '*$1*').replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/^\s*[-*]\s+/gm, '• '), 900), x.brief.missing.length ? `_Still missing: ${x.brief.missing.join(', ').toLowerCase()}_` : '');
    if (x.pkg) {
      L.push('', `*The package:* ${x.pkg.action} on ${x.pkg.target} (v${x.pkg.version} of ${x.pkg.versions}) · ${x.pkg.money}`);
      x.pkg.fields.filter((f) => f.pub).slice(0, 4).forEach((f) => L.push(`• ${f.label}: ${clip(f.value, 160)}`));
    }
    const imgs = [...(x.pkg?.assets || []).filter((a) => a.kind === 'image').map((a) => `${a.label}: ${a.url}`), ...x.card.images.slice(0, 2).map((u) => `Card image: ${u}`), ...x.versions.filter((v) => v.image && v.current).map((v) => `Current version: ${v.image}`)];
    const seenU = new Set(); const imgs2 = imgs.filter((l) => { const u = l.slice(l.lastIndexOf(' ') + 1); if (seenU.has(u)) return false; seenU.add(u); return true; });
    if (imgs2.length) L.push('', '*Assets*', ...imgs2.slice(0, 5));
    const chat = x.jam.filter((m) => !m.system).slice(-6);
    if (chat.length) L.push('', '*Jam so far*', ...chat.map((m) => `${m.who}: ${clip(m.text, 160)}`));
    const st = (x.pkg?.thread || []).slice(-4);
    if (st.length) L.push('', '*Studio chat*', ...st.map((m) => `${m.who}: ${clip(m.text, 140)}`));
    const open = x.questions.filter((q) => !q.a);
    if (open.length) L.push('', '*Open questions*', ...open.slice(0, 4).map((q) => `• ${q.q}`));
    if (x.measure) L.push('', `*How we measure it:* ${x.measure.metric}, ${x.measure.baseline != null ? `${fmt(x.measure, x.measure.baseline)} → ` : 'target '}${fmt(x.measure, x.measure.target)} in ${x.measure.window} days`);
    /* teammates open the jam itself; the ShopOS team also gets the read-only page with every asset */
    L.push('', `🎛️ *Open the jam (latest version, chat and brief):* ${x.links.jam}`);
    L.push(`📎 *The full brief, read-only (card, assets, every message, the package):* ${x.links.page}`); // both shares carry the read-only page
    L.push(to === 'brew' ? '' : `When we’re done here, paste this chat back into Brew and the brief updates.`);
    return L.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();
  };

  // the hosted page: readable on a phone, everything in one scroll, every asset downloadable
  const html = (x) => {
    const sec = (h, body) => body ? `<section><h2>${h}</h2>${body}</section>` : '';
    const md = (s) => String(s || '').split('\n').map((l) => { const e = esc(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); return /^#\s/.test(l) ? `<h3>${e.slice(2)}</h3>` : /^#{2,3}\s/.test(l) ? `<h4>${e.replace(/^#+\s/, '')}</h4>` : /^\s*[-*]\s/.test(l) ? `<li>${e.replace(/^\s*[-*]\s/, '')}</li>` : l.trim() ? `<p>${e}</p>` : ''; }).join('').replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
    const msgs = (arr) => arr.map((m) => m.system ? `<div class="sys">${esc(m.text)}</div>` : `<div class="msg${m.who === 'You' ? ' me' : ''}"><small>${esc(m.who)}${m.at ? ` · ${new Date(m.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}</small><p>${esc(m.text)}</p></div>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(x.title)} · Jam handoff</title>
<meta name="robots" content="noindex"><link rel="icon" href="/${x.mark || 'assets/brew-mark.svg'}">
<style>
:root{--bg:#f6f6f4;--card:#fff;--fg:#0b0b0b;--fg2:#555;--fg3:#8a8a8a;--line:#e7e7e3;--info:#3b5bdb;--info-bg:rgba(59,91,219,.08);--ok:#15803d;--ok-bg:rgba(21,128,61,.09);--warn:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0b;--card:#171717;--fg:#f5f5f5;--fg2:#a3a3a3;--fg3:#737373;--line:#262626;--info:#7b97f7;--info-bg:rgba(123,151,247,.12);--ok:#4ade80;--ok-bg:rgba(74,222,128,.1);--warn:#e0a63c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 16px 64px;display:flex;flex-direction:column;gap:18px}
header small{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--fg3)}h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:6px 0 8px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{font-size:12.5px;padding:4px 10px;border-radius:999px;background:var(--card);border:1px solid var(--line);color:var(--fg2);text-decoration:none}a.chip{color:var(--info)}
section{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 20px}h2{margin:0 0 12px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--fg3)}
h3{font-size:18px;margin:.4em 0}h4{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--fg3);margin:1.2em 0 .3em}p{margin:.3em 0}ul{margin:.3em 0;padding-left:1.2em}
.lead{font-size:20px;font-weight:600;line-height:1.3;margin:0}.sub{color:var(--fg2);margin:.4em 0 0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-top:12px}.stat{border:1px solid var(--line);border-radius:12px;padding:10px 12px}.stat b{display:block;font-size:16px}.stat span{font-size:12px;color:var(--fg3)}
.imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:12px}.imgs figure{margin:0}.imgs img{width:100%;border-radius:12px;border:1px solid var(--line);display:block}.imgs figcaption{font-size:12px;color:var(--fg2);display:flex;justify-content:space-between;gap:6px;margin-top:4px}.imgs a{color:var(--info)}
.opt{border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-top:8px}.opt.pick{border-color:var(--info);background:var(--info-bg)}.opt.chosen{border-color:var(--ok);background:var(--ok-bg)}.opt b{font-size:15.5px}.tag{font-size:11.5px;font-weight:600;margin-left:6px;color:var(--info)}.opt.chosen .tag{color:var(--ok)}.eff{font-size:13.5px;color:var(--fg2)}
.mv{display:flex;gap:12px;margin-top:10px}.mv .n{flex:0 0 46px;height:46px;border-radius:12px;background:var(--fg);color:var(--bg);display:grid;place-items:center;font-weight:700}.mv .num{color:var(--info);font-weight:650}
.msg{margin:8px 0;max-width:88%}.msg small{font-size:11.5px;color:var(--fg3)}.msg p{margin:2px 0 0;padding:8px 12px;border-radius:12px;background:var(--bg);white-space:pre-wrap}.msg.me{margin-left:auto}.msg.me small{display:block;text-align:right}.msg.me p{background:var(--fg);color:var(--bg)}.sys{font-size:12px;color:var(--fg3);text-align:center;margin:8px 0}
dl{margin:0}dl div{padding:8px 0;border-top:1px solid var(--line)}dl div:first-child{border-top:0}dt{font-size:12px;color:var(--fg3)}dt em{font-style:normal;color:var(--ok);margin-left:6px}dd{margin:2px 0 0;white-space:pre-wrap}
pre{white-space:pre-wrap;background:var(--bg);border-radius:10px;padding:10px 12px;font:13px/1.5 ui-monospace,Menlo,monospace;margin:6px 0 0}
.vers{display:flex;flex-direction:column;gap:8px}.ver{display:flex;gap:10px;align-items:flex-start}.ver img{width:64px;border-radius:8px}.ver.cur b::after{content:" · current";color:var(--ok);font-weight:500;font-size:12px}
.miss{color:var(--warn);font-size:13.5px}.foot{font-size:12px;color:var(--fg3);text-align:center}
</style></head><body><main>
<header><small>${esc(x.brand)} × Brew · Jam handoff${x.ticket ? ` · ${esc(x.ticket)}` : ''}${x.frozenAt ? ` · shared ${esc(new Date(x.frozenAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}, as it was then` : ''}</small><h1>${esc(x.title)}</h1>
<div class="chips"><span class="chip">${esc(x.card.agent)}${x.card.type ? ' · ' + esc(x.card.type) : ''}</span><span class="chip">${esc(x.stage)}${x.with ? ' · ' + esc(x.with) : ''}</span><a class="chip" href="${esc(x.links.jam)}">Open the jam in Brew ↗</a>${x.links.studio ? `<a class="chip" href="${esc(x.links.studio)}">Open in the studio ↗</a>` : ''}</div></header>
${x.now ? sec('Where it is now', `<p class="lead">${esc(x.now.head)}</p>${x.now.line ? `<p class="sub">${esc(x.now.line)}</p>` : ''}${x.now.extra ? `<p class="eff">${esc(x.now.extra)}</p>` : ''}`) : ''}
${sec('The card', `<p class="lead">${esc(x.card.title)}</p><p class="sub">${esc(x.card.sub)}</p>${x.card.rows.length ? `<div class="stats">${x.card.rows.map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>` : ''}${x.card.images.length ? `<div class="imgs">${x.card.images.map((u) => `<figure><img src="${esc(u)}" alt=""><figcaption>Card image <a href="${esc(u)}" download target="_blank">Download</a></figcaption></figure>`).join('')}</div>` : ''}${x.card.src ? `<p class="sub" style="font-size:13px">From ${esc(x.card.src)}</p>` : ''}`)}
${x.page ? sec(x.decided ? 'What we decided' : 'The options', `${x.page.lead ? `<p><b>${esc(x.page.lead)}</b></p>` : ''}${x.page.options.map((o) => `<div class="opt${o.chosen ? ' chosen' : o.pick && !x.decided ? ' pick' : ''}"><b>${esc(o.name)}</b>${o.chosen ? '<span class="tag">✓ Going with this</span>' : o.pick ? '<span class="tag">Brew pick</span>' : ''}<p>${esc(o.says)}</p><p class="eff">What changes: ${esc(o.effect)}</p>${o.measure ? `<p class="eff">How we’d know: ${esc(optMeasure(o.measure))}</p>` : ''}${o.moves?.length ? `<p class="eff">Backed by ${o.moves.map((n) => `Move ${String(n).padStart(2, '0')}`).join(', ')}</p>` : ''}</div>`).join('')}${x.page.reason ? `<h4>Why Brew picks it</h4><p>${esc(x.page.reason)}</p>` : ''}${x.page.follows.length ? `<p class="eff">What follows: ${x.page.follows.map(esc).join(' · ')}</p>` : ''}`) : ''}
${x.page?.moves.length ? sec('What the moves say', x.page.moves.map((mv) => `<div class="mv"><div class="n">${String(mv.n).padStart(2, '0')}</div><div><b>${esc(mv.title)}</b><p class="eff">${esc(mv.plain)}</p>${mv.number ? `<p class="num">${esc(mv.number)}</p>` : ''}<p>${esc(mv.says)}</p>${mv.points.length ? `<ul>${mv.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div></div>`).join('')) : ''}
${x.brief ? sec(`The brief${x.brief.kind ? ' · ' + esc(x.brief.kind) : ''}`, md(x.brief.md) + (x.brief.missing.length ? `<p class="miss">Still missing: ${esc(x.brief.missing.join(', ').toLowerCase())}</p>` : '')) : ''}
${x.pkg ? sec(`The package · ${esc(x.pkg.family)} · v${x.pkg.version} of ${x.pkg.versions}`, `<p><b>${esc(x.pkg.action)}</b> on ${esc(x.pkg.target)} · ${esc(x.pkg.money)} · ${esc(x.pkg.undo)}</p>
  ${x.pkg.assets.filter((a) => a.kind === 'image').length ? `<div class="imgs">${x.pkg.assets.filter((a) => a.kind === 'image').map((a) => `<figure><img src="${esc(a.url)}" alt=""><figcaption>${esc(a.label)} <a href="${esc(a.url)}" download target="_blank">Download</a></figcaption></figure>`).join('')}</div>` : ''}
  <dl style="margin-top:12px">${x.pkg.fields.map((f) => `<div><dt>${esc(f.label)}${f.pub ? '<em>customers see this</em>' : ''}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl>
  ${x.pkg.assets.filter((a) => a.kind !== 'image').map((a) => a.kind === 'link' ? `<p><a href="${esc(a.url)}" target="_blank">${esc(a.label)} ↗</a></p>` : a.kind === 'todo' ? `<p class="miss">To do: ${esc(a.label)}: ${esc(a.text)}</p>` : `<h4>${esc(a.label)}</h4><pre>${esc(a.text)}</pre>`).join('')}
  ${x.pkg.notes.length ? `<h4>Notes</h4><ul>${x.pkg.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}${x.pkg.checks.length ? `<h4>Checks</h4><ul>${x.pkg.checks.map((c) => `<li>${c.done ? '✓' : '○'} ${esc(c.text)}</li>`).join('')}</ul>` : ''}`) : ''}
${x.versions.length > 1 ? sec('Versions', `<div class="vers">${x.versions.map((v) => `<div class="ver${v.current ? ' cur' : ''}">${v.image ? `<img src="${esc(v.image)}" alt="">` : ''}<div><b>v${v.n} · ${esc(v.title)}</b><p class="eff">${esc(v.sub)}</p><p class="eff">${esc([v.by, v.note].filter(Boolean).join(' · '))}</p></div></div>`).join('')}</div>`) : ''}
${x.jam.length ? sec('The jam chat', msgs(x.jam)) : ''}
${x.pkg?.thread.length ? sec('The studio chat (remix)', msgs(x.pkg.thread.map((m) => ({ who: m.who, text: m.text + (m.v ? ` (made v${m.v})` : ''), at: m.at })))) : ''}
${x.questions.length ? sec('Questions', `<ul>${x.questions.map((q) => `<li><b>${esc(q.q)}</b>${q.a ? `<br>${esc(q.a)}` : ' <span class="miss">(open)</span>'}</li>`).join('')}</ul>`) : ''}
${x.measure ? sec('How we measure it', `<p><b>${esc(x.measure.metric)}</b>: ${x.measure.baseline != null ? `${esc(fmt(x.measure, x.measure.baseline))} → ` : 'target '}${esc(fmt(x.measure, x.measure.target))}, read after ${esc(x.measure.window)} days</p>${x.measure.watch.length ? `<p class="eff">We watch: ${x.measure.watch.map(esc).join(', ')}</p>` : ''}${x.measure.attribution ? `<p class="eff">${esc(x.measure.attribution)}</p>` : ''}`) : ''}
<p class="foot">Live view of the jam · updated ${new Date(x.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
</main></body></html>`;
  };

  return { build, text, html, path: handoffPath, jam: jamPath };
}
