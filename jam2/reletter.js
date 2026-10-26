// A claim set in our own words on a made picture (a badge, a headline, a line: text layers laid over the shot) comes off without a
// new photo: the layers lose the sentence that carries it (a layer left empty goes), and the scene is drawn again. Words a model drew
// into the picture itself can't come off this way: those slides are named.
export function stripScenes(take, phrases) {
  const low = (phrases || []).map((p) => String(p || '').toLowerCase().trim()).filter(Boolean);
  const hit = (s) => typeof s === 'string' && low.some((p) => s.toLowerCase().includes(p));
  const strip = (s) => (hit(s) ? s.split(/(?<=[.!?·|•])\s+/).filter((x) => !hit(x)).join(' ').trim() : s);
  const set = (take?.slides || []).length > 0, slides0 = set ? take.slides : [{ scene: take?.scene, file: take?.file, words: take?.words, drawn: take?.drawn || null }];
  const drawn = [], out = slides0.map((s, i) => {
    const layers = s?.scene?.layers || [];
    if (!low.length || !layers.some((l) => hit(l?.words) || hit(l?.text))) { if (s?.drawn) drawn.push(i + 1); return { slide: s, changed: false }; }
    const scene = { ...s.scene, layers: layers.map((l) => (hit(l?.words) || hit(l?.text) ? { ...l, ...(typeof l.words === 'string' ? { words: strip(l.words) } : {}), ...(typeof l.text === 'string' ? { text: strip(l.text) } : {}) } : l))
      .filter((l) => !['text', 'badge'].includes(l?.kind) || String(l.words ?? l.text ?? '').trim()) };
    const words = Object.fromEntries(Object.entries(s.words || {}).map(([k, v]) => [k, typeof v === 'string' ? strip(v) : Array.isArray(v) ? v.map(strip).filter(Boolean) : v]));
    return { slide: { ...s, scene, words }, changed: true }; });
  return { set, slides: out, drawn };
}
