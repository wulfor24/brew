// What a jam's piece is, for the jam page (26 Oct redesign, the prototype Param approved): which of the ten layouts draws it, and
// Brew's one line on what it set up ("One message to **past buyers**, in English, with one button."). Every piece has both, so the
// page never opens on an empty line. Words in ** ** are the ones the page sets in bold.
import { dlOf } from './deliverables.js';
import { BN } from './brand-ctx.js';

export const LAYOUTS = { pic: 'Picture', set: 'Several pictures', reel: 'Video', msg: 'Message', mail: 'Email', page: 'Page', post: 'Community post', acct: 'Account change', check: 'Checklist', brief: 'Brief' };

const SET_ACTS = /(?:^|\.)(?:carousel_ad|collection_ad|catalog_ad|ig_carousel|ig_story|listing_content|buyer_deck)$/;
const CHAT = /whatsapp|sms|rcs/i;
/* the layout a piece is drawn in: a catalogue deliverable's own, else by what it is */
export const layoutOf = (ch = {}) => {
  const row = ch.dl ? dlOf(ch.dl) : null; if (row?.layout) return row.layout === 'acct' ? 'acct' : row.layout;
  const a = String(ch.action || ''), k = a.split('.').pop(), f = ch.family, p = ch.pkg || {};
  if (ch.studio) return /video|reel|ugc|film/.test(String(ch.studio)) || p.video ? 'reel' : SET_ACTS.test(a) || (p.cardImages || []).length > 1 ? 'set' : 'pic';
  if (k === 'short_video' || k === 'film_brief') return 'reel';
  if (SET_ACTS.test(a) || (p.aplus || []).length || (p.photoSet || []).length) return 'set';
  if (f === 'meta_ad' || f === 'social' || f === 'print') return 'pic';
  if (f === 'post') return 'post';
  if (f === 'crm') return CHAT.test(String(p.channel || '')) || /paid_broadcast|whatsapp/.test(k) ? 'msg' : /new_segment|flow_timing/.test(k) ? 'acct' : 'mail';
  if (f === 'outreach') return 'mail';
  if (f === 'store' || f === 'vis' || f === 'listing' || f === 'search') return 'page';
  if (f === 'meta_ops') return 'acct';
  return 'check'; /* setup, brief, decision and anything new: steps someone can tick */
};

const cut = (x, n) => { x = String(x || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : x; };
const first = (x) => String(x || '').split(/(?<=[.!?])\s+/)[0];
const SHAPE = { '4:5': 'Feed 4:5', '9:16': 'Story 9:16', '1:1': 'Square 1:1', '16:9': 'Wide 16:9', '2:3': 'Pin 2:3' };
const lower = (x) => String(x || '').replace(/^([A-Z])(?=[a-z])/, (m) => m.toLowerCase());

/* Brew's one line: what it set up, from the piece itself; the product in bold where there is one. Never empty */
export const setupLine = (ch = {}, product = null) => {
  const p = ch.pkg || {}, L = layoutOf(ch), prod = product?.name ? `the **${cut(product.name.split(/\s+[–—|-]\s+/)[0], 64)}**` : '', row = ch.dl ? dlOf(ch.dl) : null;
  if (row && !row.action) return `${row.name}: ${cut(lower(first(row.what)), 150)}${/[.!?]$/.test(first(row.what)) ? '' : '.'}`; /* a planning deliverable: what the catalogue says it is */
  const who = cut(p.segment || p.audience || p.trigger || '', 40), shape = SHAPE[p.format] || '';
  switch (L) {
    case 'pic': return `One picture${prod ? ` of ${prod}` : ''}${shape ? `, ${shape}` : ''}.`;
    case 'set': { const n = (p.cards || p.slides || p.cardImages || p.aplus || []).length; return `${n > 1 ? `**${n} slides**` : 'A set of slides'}${prod ? ` on ${prod}` : ''}${shape ? `, ${shape}` : ''}.`; }
    case 'reel': { const s = +p.seconds || +p.length || null; return `A ${s ? `**${s}-second**` : '**short**'} video${prod ? ` of ${prod}` : ''}. The script is free.`; }
    case 'msg': return `One ${cut(p.channel || 'WhatsApp', 12)} message${who ? ` to **${lower(who)}**` : ''}${(p.buttons || []).length ? `, with ${p.buttons.length === 1 ? 'one button' : `${p.buttons.length} buttons`}` : ''}.`;
    case 'mail': return `${p.subject ? `An email, “${cut(p.subject, 60)}”` : 'An email'}${who ? `, to **${lower(who)}**` : ''}.`;
    case 'page': return `${p.heading ? `A page, “${cut(p.heading, 60)}”` : `The ${lower(ch.actionLabel || 'page')}`}${p.pages ? ` on ${cut(p.pages, 40)}` : ''}.`;
    case 'post': { const net = cut(String(p.platform && !/^social post$/i.test(p.platform) ? p.platform : ch.target?.name || ch.actionLabel || 'post').replace(/\s+(?:post|reply|thread|answer)$/i, ''), 30), what = /reply|answer/i.test(ch.actionLabel || '') ? 'reply' : /thread/i.test(ch.actionLabel || '') ? 'thread' : 'post';
      const place = String((p.where || [])[0]?.name || '').split(/:\s+/)[0], says = /\b(?:i|we) work at\b|disclosure/i.test(String(p.copy || ''));
      return place && /^r\/|group|community|forum/i.test(place) ? `A ${what} in **${cut(place, 40)}**${says ? ` that says you work at ${(() => { try { return BN() || 'the brand'; } catch { return 'the brand'; } })()}` : ''}.` : `A **${net}** ${what}, ready to paste.`; }
    case 'acct': return `${cut(p.summary || p.rule || ch.after?.title || ch.actionLabel, 110)}${p.tool || ch.target?.name ? ` in **${cut(p.tool || ch.target.name, 30)}**` : ''}.`.replace(/\.\./, '.');
    default: { const n = (p.steps || p.changes || p.scenes || []).length; return `**${cut(p.what || p.title || p.decision || ch.actionLabel, 70)}**${n ? `: ${n} step${n > 1 ? 's' : ''}` : ''}${p.tool ? ` in ${cut(p.tool, 30)}` : ''}.`.replace(/\.\./, '.'); }
  }
};
