// What a jam's piece is, for the jam page (26 Oct redesign, the prototype Param approved): which of the ten layouts draws it, and
// Brew's one line on what it set up ("One message to **past buyers**, in English, with one button."). Every piece has both, so the
// page never opens on an empty line. Words in ** ** are the ones the page sets in bold.
import { dlOf } from './deliverables.js';
import { BN } from './brand-ctx.js';
import { docTitle, beatsEnd } from './jam-words.js'; // a checklist's heading, a script's length (26 Oct)

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

const cut = (x, n) => { x = String(x || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1).replace(/\s+\S*$/, '').replace(/[\s,;:.–—-]+$/, '')}…` : x; }; /* never "…." or ",…" (QV P2-1, 26 Oct) */
/* who it goes to, at a whole phrase: "active cart abandoners and recurring…" read cut mid-phrase (QV P2-28, 26 Oct) */
const phrase = (x, n) => { x = String(x || '').replace(/\s+/g, ' ').trim(); if (x.length <= n) return x; const m = /^(.{12,}?)(?:,|\s+(?:and|or|who|with|that|from|in the last|in|of)\s)/i.exec(x); return m && m[1].length <= n ? m[1] : cut(x, n); };
const stop = (x) => (/[.!?…]$/.test(x) ? x : `${x}.`);
const first = (x) => String(x || '').split(/(?<=[.!?])\s+/)[0];
const SHAPE = { '4:5': 'Feed 4:5', '9:16': 'Story 9:16', '1:1': 'Square 1:1', '16:9': 'Wide 16:9', '2:3': 'Pin 2:3' };
/* the piece's name, the way the prototype names it ("Meta ad", "Email", "Marketplace listing"), never the card's button words
   ("Rewrite listing content" read "Carousel" over a marketplace listing: QV P1-4, 26 Oct). The page and its tabs use it */
export const VERBISH = /^(?:make|add|swap|launch|queue|rewrite|change|publish|fix|pause|set|scale|shift|exclude|update|restart|post|reply|answer|print|ask|brief|draft|request|create|turn|use|approve|write|send|build|start|run|plan|save|generate|push|apply)\b/i;
const KIND = { listing_content: 'Marketplace listing', listing_titles: 'Marketplace titles', ig_story: 'Instagram Stories', ig_carousel: 'Instagram carousel', carousel_ad: 'Carousel ad', collection_ad: 'Collection ad', catalog_ad: 'Catalogue ad', buyer_deck: 'Buyer deck', plan: 'Team plan' };
export const kindOf = (ch = {}) => { const lab = String(ch.actionLabel || ''); if (ch.dl) return dlOf(ch.dl)?.name || lab; /* the catalogue's name, so a renamed row heals on saved jams */ const k = String(ch.action || '').split('.').pop();
  if (KIND[k] && (!lab || VERBISH.test(lab))) return KIND[k]; if (!VERBISH.test(lab)) return lab; const p = ch.pkg || {}, L = ch.layout || layoutOf(ch);
  if (ch.family === 'meta_ad') return /video|reel/i.test(lab) ? 'Meta video ad' : 'Meta ad';
  if (L === 'msg') return `${/sms/i.test(p.channel || '') ? 'SMS' : 'WhatsApp'} message`; if (L === 'mail') return ch.family === 'outreach' ? 'Outreach email' : 'Email';
  if (L === 'post') { const pl = String(p.platform || ''); return pl && !/^social post$/i.test(pl) ? pl.charAt(0).toUpperCase() + pl.slice(1) : lab.replace(/^(reply|post|answer) (?:on|in) (.+)$/i, (m, a, b) => `${b} ${a.toLowerCase()}`); }
  if (ch.family === 'listing') return 'Marketplace listing';
  return { pic: 'Picture', set: 'Carousel', reel: 'Video', page: 'Page', acct: `${ch.target?.name || 'Account'} change`, check: ch.family === 'decision' ? 'Team plan' : 'Checklist' }[L] || lab; };
const lower = (x) => String(x || '').replace(/^([A-Z])(?=[a-z])/, (m) => m.toLowerCase());

/* Brew's one line: what it set up, from the piece itself; the product in bold where there is one. Never empty */
export const setupLine = (ch = {}, product = null) => {
  const p = ch.pkg || {}, L = layoutOf(ch), prod = product?.name ? `the **${cut(product.name.split(/\s+[–—|-]\s+/)[0], 64)}**` : '', row = ch.dl ? dlOf(ch.dl) : null;
  if (row && !row.action) return `${row.name}: ${cut(lower(first(row.what)), 150)}${/[.!?]$/.test(first(row.what)) ? '' : '.'}`; /* a planning deliverable: what the catalogue says it is */
  const who = phrase(p.segment || p.audience || p.trigger || '', 40), shape = SHAPE[p.format] || '';
  if (ch.family === 'listing') { const nb = (p.bullets || []).length, mk = [...new Set((p.items || []).map((r) => String(r?.marketplace || '').trim()).filter(Boolean))];
    return `A **marketplace listing**${prod ? ` for ${prod}` : ''}: the title${nb ? `, ${nb} bullet${nb > 1 ? 's' : ''}` : ''} and the photos${mk.length ? `, on ${mk.length > 3 ? `${mk.length} marketplaces` : mk.join(' and ').replace(/ and (?=.* and )/g, ', ')}` : ''}.`; } /* a listing is no set of slides (QV P1-4, 26 Oct) */
  switch (L) {
    case 'pic': return `One picture${prod ? ` of ${prod}` : ''}${shape ? `, ${shape}` : ''}.`;
    case 'set': { const n = (p.cards || p.slides || p.cardImages || p.aplus || []).length; return `${n > 1 ? `**${n} slides**` : 'A set of slides'}${prod ? ` on ${prod}` : ''}${shape ? `, ${shape}` : ''}.`; }
    case 'reel': { const s = +p.seconds || +p.length || beatsEnd(p.script) || null; /* the length the beats run to (QV P1-7) */ return `A ${s ? `**${s}-second**` : '**short**'} video${prod ? ` of ${prod}` : ''}. The script is free.`; }
    case 'msg': return `One ${cut(p.channel || 'WhatsApp', 12)} message${who ? ` to **${lower(who)}**` : ''}${(p.buttons || []).length ? `, with ${p.buttons.length === 1 ? 'one button' : `${p.buttons.length} buttons`}` : ''}.`;
    case 'mail': return `${p.subject ? `An email, “${cut(p.subject, 60)}”` : 'An email'}${who ? `, to **${lower(who)}**` : ''}.`;
    case 'page': return `${p.heading ? `A page, “${cut(p.heading, 60)}”` : `The ${lower(ch.actionLabel || 'page')}`}${p.pages ? ` on ${cut(String(p.pages).split(/\s+[–—|-]\s+/)[0], 40)}` : ''}.`;
    case 'post': { const net = cut(String(p.platform && !/^social post$/i.test(p.platform) ? p.platform : ch.target?.name || ch.actionLabel || 'post').replace(/\s+(?:post|reply|thread|answer)$/i, ''), 30), what = /reply|answer/i.test(ch.actionLabel || '') ? 'reply' : /thread/i.test(ch.actionLabel || '') ? 'thread' : 'post';
      const place = String((p.where || [])[0]?.name || '').split(/:\s+/)[0], says = /\b(?:i|we) work at\b|disclosure/i.test(String(p.copy || ''));
      return place && /^r\/|group|community|forum/i.test(place) ? `A ${what} in **${cut(place, 40)}**${says ? ` that says you work at ${(() => { try { return BN() || 'the brand'; } catch { return 'the brand'; } })()}` : ''}.` : `A **${net}** ${what}, ready to paste.`; }
    case 'acct': return stop(`${cut(String(p.summary || p.rule || ch.after?.title || ch.actionLabel).replace(/[.!]+$/, ''), 110)}${p.tool || ch.target?.name ? ` in **${cut(p.tool || ch.target.name, 30)}**` : ''}`);
    default: { const n = (p.steps || p.changes || p.scenes || []).length; return stop(`**${cut(p.title || (p.what ? docTitle(p.what) : '') || (p.decision ? docTitle(p.decision) : '') || ch.actionLabel, 70)}**${n ? `: ${n} step${n > 1 ? 's' : ''}` : ''}${p.tool ? ` in ${cut(p.tool, 30)}` : ''}`); } /* the heading, never the whole markdown text (QV P1-8, 26 Oct) */
  }
};
