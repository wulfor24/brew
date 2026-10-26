// A budget draft (Meta shift or scale) checked against its card and the connected account: it moves the card's amount between the
// card's campaigns, every campaign it names is a real one, and a draft whose card was withdrawn can't ship (Round 2: 1.1, 3.9).
import { numbersIn } from './fact-gate.js';

export const budgetMatch = (card, ch, t = null) => { if (ch.family !== 'meta_ops' || !/(shift|scale)_budget$/.test(ch.action || '')) return null;
  /* the account's own budget card is gone (today's numbers no longer support the move): the saved draft can't ship as it is */
  if (/^live-meta-shift/.test(String(ch.cardId || '')) && !card?.shift) return { k: 'Your Meta account no longer supports this play: the budget card was withdrawn on today’s numbers. Check the campaigns in Ads Manager before moving anything.', ok: false };
  /* every campaign or ad set the draft moves is a real one in the connected account, never a made-up name (2.6) */
  const live = t?.member ? t.liveLedger?.['meta.campaigns.7d'] : null, known = live && !live.stale ? String(live.v).split(/;\s*/).map((x) => x.split(':')[0].trim()).filter(Boolean) : [], low = known.map((k) => k.toLowerCase());
  const names = (ch.pkg?.items || []).filter((x) => !x?.pick /* a row waiting for the team to name it (ops-rows.js) */).map((x) => String(x?.name || '').trim()).filter(Boolean), unknown = known.length ? [...new Set(names.filter((n) => !low.some((k) => k === n.toLowerCase() || k.includes(n.toLowerCase()) || n.toLowerCase().includes(k))))] : [];
  if (unknown.length) return { k: `${unknown.slice(0, 2).map((n) => `“${n.slice(0, 60)}”`).join(' and ')} ${unknown.length === 1 ? 'isn’t a campaign' : 'aren’t campaigns'} in your Meta account this week. Use one of yours: ${known.slice(0, 3).map((k) => k.slice(0, 40)).join('; ')}`, ok: false, fix: true };
  const money = (x) => numbersIn(JSON.stringify(x ?? '')).filter((n) => /^[^\d%]+\d/.test(n));
  const said = [...new Set(money([card.title, card.sub, card.shift ? [card.shift.perDay] : []]))], made = new Set(money(ch.pkg));
  const camps = card.shift ? [card.shift.from, card.shift.to] : [], txt = JSON.stringify(ch.pkg || {});
  const offAmt = said.length && !said.some((n) => made.has(n)), offCamp = camps.filter((x) => x && !txt.includes(x));
  if (!offAmt && !offCamp.length) return { k: 'The draft moves what the card says', ok: true };
  return { k: offAmt ? `The card says ${said.join(' or ')}; the draft moves ${[...made].join(', ') || 'no amount'}` : `The draft doesn't name ${offCamp.join(' and ')}, the campaigns the card moves`, ok: false, fix: true }; };
