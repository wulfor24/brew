// An inline header <svg> as a logo file: a sprite reference (<use href="#id">) points at a <symbol> elsewhere on the store's
// page, so saved alone it draws nothing (footshop-com, QA 20 Oct). The symbol is inlined from the page; an svg that still
// has nothing to draw is no logo.
const SHAPES = /<(?:path|rect|circle|ellipse|polygon|polyline|line|image|text)\b/i;
export const drawableSvg = (svg) => { const s = String(svg || ''); return /<svg\b/i.test(s) && SHAPES.test(s); };
export function inlineSprite(svg, html = '') {
  let s = String(svg || ''); if (!/<use\b/i.test(s)) return s;
  s = s.replace(/<use\b[^>]*?(?:xlink:)?href\s*=\s*["']#([^"']+)["'][^>]*?(?:\/>|>\s*<\/use>)/gi, (m, id) => {
    const sym = String(html).match(new RegExp(`<symbol\\b[^>]*\\bid\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([\\s\\S]*?)</symbol>`, 'i'));
    if (!sym) return m; const vb = (sym[0].match(/\bviewBox\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (vb && !/\bviewBox=/i.test(s)) s = s.replace(/<svg\b/i, `<svg viewBox="${vb}"`);
    return sym[1]; });
  if (!/\bxmlns=/.test(s)) s = s.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (/xlink:/i.test(s) && !/xmlns:xlink=/i.test(s)) s = s.replace(/<svg\b/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  return s;
}
