// An ad account change names real campaigns: every row of a budget, pause, rule or exclusion draft is a campaign from the
// connected Meta account (the 7-day ledger), never a product or a made-up ad set ("Serum Roller Combo" sat in the name column
// with "Creator Content" under Now: 25 Oct). Rows the writer named wrongly are matched to the account's campaigns by the
// card's own words. Names change only when this read has the account's campaigns (a member's read of a connected account): a
// read without them never rewrites a saved draft, it only says the names weren't checked. Now and After say only the setting
// that changes, never the campaign's whole targeting line or a "Now:" label. Runs on every read, so saved drafts heal.
const CAMP_ACTS = /\.(?:scale_budget|shift_budget|pause_losers|stop_rule|exclude_audience)$/;
const STOP = new Set(['the', 'and', 'for', 'ads', 'ad', 'set', 'sets', 'campaign', 'campaigns', 'meta', 'tof', 'mof', 'bof', 'conv', 'conversion', 'conversions', 'sales', 'purchase', 'purchases', 'new', 'all', 'with', 'from', 'this', 'that', 'our', 'your', 'brand', 'customers', 'customer', 'existing', 'past', 'buyers']);
const toks = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
export const NO_CAMP = 'Your campaign (connect Meta to name it)';

/* the connected account's campaigns this week: name, spend a day and the rest of the ledger line */
export const ledgerCamps = (t) => { const live = t?.member ? t.liveLedger?.['meta.campaigns.7d'] : null; if (!live || live.stale) return null;
  return String(live.v || '').split(/;\s*/).map((x) => { const i = x.indexOf(':'), name = (i > 0 ? x.slice(0, i) : x).trim(), rest = i > 0 ? x.slice(i + 1) : '';
    return { name, day: (/([^\s,]*\d[\d,.]*\s*[KkLM]?) a day/.exec(rest) || [])[1] || null }; }).filter((x) => x.name); };

const known = (camps, n) => { const l = String(n || '').trim().toLowerCase(); return !!l && camps.some((k) => { const kl = k.name.toLowerCase(); return kl === l || kl.includes(l) || l.includes(kl); }); };
/* the campaigns the card is about: most words shared with the card (its title, body, rows and evidence) and the row the writer named */
const rank = (camps, text, used) => { const tw = new Set(toks(text));
  return camps.filter((k) => !used.has(k.name)).map((k) => [k, toks(k.name).filter((w) => tw.has(w)).length]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0]); };
/* "Prospecting | Broad 22-45 | Reels | not excluded, budget as set today | excluded, budget +20%": the last part is the setting */
const setting = (x) => { const s = String(x ?? '').trim(); const parts = s.split(/\s+\|\s+/); return (parts.length > 2 ? parts[parts.length - 1] : s).replace(/^(?:now|next|after|before|then)\s*:\s*/i, '').slice(0, 120); };

export const healOps = (t, ch, card = {}) => { if (ch?.family !== 'meta_ops' || !CAMP_ACTS.test(ch.action || '') || !Array.isArray(ch.pkg?.items) || card?.shift) return false;
  const camps = ledgerCamps(t); if (camps && !camps.length) return false;
  /* 25 Oct, first cut: a read without the account wrote "connect Meta" over the draft's names; give them back */
  if (ch.pkg.items.some((x) => x?.name === NO_CAMP && x.was)) { ch.pkg = { ...ch.pkg, items: ch.pkg.items.map((x) => (x?.name === NO_CAMP && x.was ? (({ was, pick, ...r }) => ({ ...r, name: was }))(x) : x)) }; }
  const act = String(ch.action).split('.').pop(), text = JSON.stringify([card.title, card.sub, card.rows, card.detail, card.evidence]);
  let changed = false; const used = new Set(), out = [], orig = new Set();
  for (const it of ch.pkg.items.slice(0, 5)) { const row = { ...it };
    /* the writer named one product on two rows: one campaign, never the same thing twice */
    const key = String(row.was || row.name || '').trim().toLowerCase(); if (camps && key && !known(camps, row.name) && orig.has(key)) { changed = true; continue; } orig.add(key);
    for (const k of ['now', 'next']) { const v = setting(row[k]); if (v !== row[k]) { row[k] = v; changed = true; } }
    if (act === 'exclude_audience') { if (!/buyer|purchas|customer|exclu/i.test(row.now || '')) { row.now = 'Past buyers can see it'; changed = true; } if (!/exclu/i.test(row.next || '')) { row.next = 'Past buyers excluded'; changed = true; } }
    if (camps) { if (known(camps, row.name)) { used.add(camps.find((k) => known([k], row.name)).name); out.push(row); continue; }
      const pick = rank(camps, `${text} ${row.name}`, used)[0];
      if (pick) { used.add(pick.name); out.push({ ...row, was: row.was || row.name, name: pick.name, picked: true, ...(/budget/.test(act) && pick.day && !/\d/.test(row.now || '') ? { now: `About ${pick.day} a day` } : {}) }); changed = true; continue; }
      /* no campaign shares a word with the card: the team names it; the check below lists the account's biggest ones */
      if (row.name !== 'Pick the campaign') { out.push({ ...row, was: row.was || row.name, name: 'Pick the campaign', pick: true }); changed = true; } else out.push(row); continue; }
    out.push(row); /* no campaigns in this read: the names stay as written (the check says they weren't checked) */ }
  /* one row per campaign: a writer that named one product twice became the same campaign twice */
  const seen = new Set(), rows = out.filter((r) => !(r.picked || r.name === 'Pick the campaign' || r.name === NO_CAMP) || !seen.has(r.name) && seen.add(r.name));
  if (rows.length !== out.length) changed = true;
  if (changed) ch.pkg = { ...ch.pkg, items: rows.length ? rows : out.slice(0, 1) };
  return changed; };

/* the check the jam shows for rows Brew had to fill: soft when Brew matched a real campaign, a step for the team when it couldn't */
export const opsCheck = (t, ch) => { if (ch?.family !== 'meta_ops' || !CAMP_ACTS.test(ch.action || '')) return null; const items = ch.pkg?.items || [];
  if (!ledgerCamps(t) && items.some((x) => x?.name && !/^the (?:ad sets|campaigns) your team picks$/i.test(x.name))) return { k: 'Brew couldn’t check these campaign names against your Meta account: confirm them in Ads Manager before you change anything', ok: false, soft: true };
  if (items.some((x) => x.name === 'Pick the campaign')) { const top = (ledgerCamps(t) || []).slice(0, 3).map((k) => k.name.slice(0, 40)); return { k: `Name the campaign${top.length ? `: for example ${top.join('; ')}` : ''}`, ok: false, fix: true }; }
  if (items.some((x) => x.picked)) return { k: `Brew matched ${items.filter((x) => x.picked).length > 1 ? 'these campaigns' : 'this campaign'} from your account to the card: check ${items.filter((x) => x.picked).length > 1 ? 'they are' : 'it is'} the right one`, ok: false, soft: true };
  return null; };
