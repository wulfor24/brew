// One look for every email Brew sends (invites, team changes, moves ready, jam emails, the ShopOS team).
// Email clients are not browsers: tables for layout, inline styles only, no SVG, no web fonts, a PNG logo
// served from the live site, a hidden preheader for the inbox preview, and a button that still works when
// images are off. Callers pass plain text; only `body` and `after` take ready HTML (build it with p(), quote(), list()).
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* UI2 look (2026-10-16): the app's ink (#0a0a0a), its type stack, 20/12 radii, and a dark band with the mark on top.
   The card stays light: mail apps invert dark emails unpredictably. */
const FONT = `'SF Pro Text',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
const C = { page: '#F6F6F6', card: '#FFFFFF', ink: '#0A0A0A', body: '#262626', muted: '#5C5C5C', faint: '#8A8A8A', line: '#E6E6E6', quote: '#F6F6F6', band: '#0A0A0A' };

export const p = (html, { muted = false, small = false } = {}) =>
  `<p style="margin:0 0 14px;font:${small ? '13px/1.5' : '15px/1.6'} ${FONT};color:${muted ? C.muted : C.body}">${html}</p>`;

/* someone's words, as a soft card with their name on top */
export const quote = (who, text) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border-collapse:separate"><tr><td style="background:${C.quote};border:1px solid ${C.line};border-radius:12px;padding:12px 14px">` +
  `<div style="font:600 13px/1.4 ${FONT};color:${C.ink};margin:0 0 3px">${esc(who)}</div>` +
  `<div style="font:14px/1.55 ${FONT};color:${C.body}">${esc(text)}</div></td></tr></table>`;

/* a short list of plain-text items (e.g. the moves that were rewritten) */
export const list = (items) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px">${items.map((x) =>
    `<tr><td width="18" valign="top" style="font:15px/1.6 ${FONT};color:${C.faint}">•</td><td style="font:15px/1.6 ${FONT};color:${C.body};padding:0 0 4px">${esc(x)}</td></tr>`).join('')}</table>`;

const button = (href, label) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0"><tr><td bgcolor="${C.ink}" style="border-radius:12px">` +
  `<a href="${esc(href)}" style="display:inline-block;padding:13px 22px;font:600 15px/1 ${FONT};color:#FFFFFF;text-decoration:none;border-radius:12px">${esc(label)}</a></td></tr></table>`;

/* the whole email.
   title: the big line. eyebrow: the brand it's about. body: HTML. cta: { href, label }. secondary: { href, label }.
   after: HTML under the button (small print). footer: HTML in the grey area (e.g. mute links). preheader: inbox preview text */
export function emailHtml({ title, eyebrow = '', preheader = '', body = '', cta = null, secondary = null, after = '', footer = '', base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com' }) {
  const host = String(base).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(title)}</title></head>` +
  `<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">` +
  `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader || title)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page}"><tr><td align="center" style="padding:32px 16px 40px">` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">` +
  /* logo row */
  `<tr><td bgcolor="${C.band}" style="background:${C.band};border-radius:20px 20px 0 0;padding:16px 24px"><a href="${esc(base)}" style="text-decoration:none"><table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
  `<td valign="middle"><img src="${esc(base)}/icons/icon-192.png" width="26" height="26" alt="" style="display:block;border:0;border-radius:7px"></td>` +
  `<td valign="middle" style="padding-left:9px;font:600 16px/1 ${FONT};color:#FAFAFA;letter-spacing:-.01em">Brew</td></tr></table></a></td></tr>` +
  /* card */
  `<tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-top:0;border-radius:0 0 20px 20px;padding:30px 32px 30px">` +
  (eyebrow ? `<div style="font:600 12px/1 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:${C.muted};margin:0 0 12px">${esc(eyebrow)}</div>` : '') +
  `<h1 style="margin:0 0 16px;font:600 22px/1.3 ${FONT};color:${C.ink};letter-spacing:-.015em">${esc(title)}</h1>` +
  body +
  (cta ? button(cta.href, cta.label) : '') +
  (secondary ? `<p style="margin:16px 0 0;font:14px/1.5 ${FONT}"><a href="${esc(secondary.href)}" style="color:${C.ink};text-decoration:underline">${esc(secondary.label)}</a></p>` : '') +
  (after ? `<div style="margin:24px 0 0;padding:18px 0 0;border-top:1px solid ${C.line}">${after}</div>` : '') +
  `</td></tr>` +
  /* footer */
  `<tr><td style="padding:20px 8px 0;font:12px/1.6 ${FONT};color:${C.faint}">` +
  (footer ? `<div style="margin:0 0 8px">${footer}</div>` : '') +
  `Sent by Brew · <a href="${esc(base)}" style="color:${C.faint};text-decoration:underline">${esc(host)}</a></td></tr>` +
  `</table></td></tr></table></body></html>`;
}

/* a link styled for the grey footer */
export const footLink = (href, label) => `<a href="${esc(href)}" style="color:${C.faint};text-decoration:underline">${esc(label)}</a>`;
