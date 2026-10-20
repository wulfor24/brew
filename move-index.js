// The index (Move 00) is written once, at the end of a build, so it goes stale: rows "Being written." that never will be,
// timely moves missing, titles from before a rewrite, a stored count that disagrees with the Moves page, box labels cut at
// 11 characters (moves audit 20 Oct). At load its tables, counts and diagram are rebuilt from the moves as they are now;
// only the overview's words (the thread, today, what is live) come from storage. Weekly moves (1001+) are counted apart.
export const INDEX_GROUPS = [
  ['know', 'KNOW THE BRAND', 'FOUNDATION'], ['found', 'BE FOUND', 'ORGANIC'], ['reach', 'REACH PEOPLE', 'PAID, SOCIAL, CREATORS'],
  ['convert', 'CONVERT THE VISIT', 'SITE AND LISTINGS'], ['keep', 'KEEP THE CUSTOMER', 'RETENTION'], ['expand', 'EXPAND AND OPERATE', 'B2B AND OPS']];
const pad = (n) => String(n).padStart(2, '0');
const W = 17; // every group name fits its column; box labels end on a whole word
export const playbookMoves = (moves = {}) => Object.values(moves || {}).filter((m) => m && typeof m === 'object' && +m.n > 0 && +m.n < 1000 && m.title && !m.past).sort((a, b) => a.n - b.n);
const label = (m) => String(m.skill || m.discipline || m.title || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (x) => { x = String(x || ''); if (x.length <= W) return x; const w = x.slice(0, W + 1).replace(/\s+\S*$/, '').replace(/\s+(?:and|of|the|for|to|a|&)$/i, ''); return w.length >= 3 && w.length <= W ? w : x.split(' ')[0].slice(0, W); };
export function fitIndex(idx, moves = {}) {
  if (!idx || typeof idx !== 'object' || +idx.n !== 0 || !Array.isArray(idx.sections)) return idx;
  const all = playbookMoves(moves); if (!all.length) return idx;
  const by = (g) => all.filter((m) => (m.group || 'know') === g);
  const boxes = INDEX_GROUPS.map(([g]) => by(g).slice(0, 4).map((m) => cut(label(m)).toUpperCase()));
  const box = (i, r) => (boxes[i][r] || '').padEnd(W);
  const diagram = [INDEX_GROUPS.map((g) => g[1].slice(0, W + 2).padEnd(W + 4)).join(' '), INDEX_GROUPS.map(() => '┌' + '─'.repeat(W + 2) + '┐').join('  '),
    ...[0, 1, 2, 3].map((r) => INDEX_GROUPS.map((_, i) => `│ ${box(i, r)} │`).join(r === 1 ? '─>' : '  ')), INDEX_GROUPS.map(() => '└' + '─'.repeat(W + 2) + '┘').join('  '),
    INDEX_GROUPS.map(([g]) => `${by(g).length} moves`.padEnd(W + 4)).join(' ')].join('\n');
  const sections = idx.sections.map((sec) => {
    const gi = INDEX_GROUPS.findIndex(([, h]) => h === sec?.h);
    if (gi < 0) return { ...sec, blocks: (sec.blocks || []).map((b) => (b?.t === 'diagram' && /[┌│└]/.test(b.text || '') ? { ...b, text: diagram } : b)) };
    const [g, , sub] = INDEX_GROUPS[gi], list = by(g);
    return { ...sec, blocks: (sec.blocks || []).map((b) => (b?.t === 'table' ? { ...b, rows: list.map((m) => [pad(m.n), m.title, m.gives || '', [m.stat, m.statLabel].filter(Boolean).join(' · ')]) }
      : b?.t === 'p' && /\bMOVES?\*\*\s*$/.test(b.text || '') ? { ...b, text: `**${sub} · ${list.length} MOVE${list.length === 1 ? '' : 'S'}**` } : b)) };
  });
  return { ...idx, sections, stat: String(all.length), statLabel: 'MOVES IN THE PLAYBOOK', meta: { ...(idx.meta || {}), written: all.length, total: all.length, provisional: false } };
}
