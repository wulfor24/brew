// The brand kit's colours as the maker and the brand read them: only the brand's own (never a web framework's stock colours a
// site's CSS happens to carry), and said in words, never as hex. Pure.
/* a web framework's stock colours (Tailwind, Material, Bootstrap, WordPress) that a site's CSS carries whether the brand uses them or not:
   never "the brand colours" unless the team or the store's own settings chose them (26 Oct, QV P1-17: Arata's maker read Tailwind blues) */
export const UI_DEFAULTS = new Set(['#3b82f6', '#2563eb', '#1d4ed8', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#eff6ff', '#1e40af', '#1e3a8a', '#6366f1', '#4f46e5', '#818cf8', '#ef4444', '#dc2626', '#10b981', '#34d399', '#059669', '#f59e0b', '#fbbf24', '#8b5cf6', '#ec4899', '#6b7280', '#9ca3af', '#d1d5db', '#e5e7eb', '#f3f4f6', '#f9fafb', '#374151', '#4b5563', '#1f2937', '#111827',
  '#82b1ff', '#448aff', '#2979ff', '#2962ff', '#2196f3', '#1976d2', '#3f51b5', '#f44336', '#4caf50', '#ff9800', '#9c27b0', '#e91e63', '#007bff', '#0d6efd', '#6c757d', '#343a40', '#212529', '#f8f9fa', '#e9ecef', '#dee2e6', '#28a745', '#198754', '#dc3545', '#ffc107', '#17a2b8', '#0dcaf0', '#0073aa', '#00a0d2', '#21759b']);
/* a colour said in words, the way a person names it ("deep teal", "light blue"): the maker and the brand read names, never hex */
export const colourName = (hex) => { const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex || '').trim()); if (!m) return ''; let h6 = m[1]; if (h6.length === 3) h6 = h6.replace(/./g, '$&$&');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h6.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (s < 0.12 || d < 0.06) return l > 0.93 ? 'white' : l > 0.8 ? 'off-white' : l > 0.6 ? 'light grey' : l > 0.35 ? 'grey' : l > 0.12 ? 'charcoal' : 'black';
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
  const base = h < 15 || h >= 345 ? 'red' : h < 40 ? (l < 0.45 ? 'brown' : 'orange') : h < 65 ? (l < 0.4 ? 'olive' : 'yellow') : h < 160 ? 'green' : h < 195 ? 'teal' : h < 250 ? 'blue' : h < 290 ? 'purple' : 'pink';
  return `${l > 0.78 ? 'light ' : l < 0.3 ? 'deep ' : s < 0.35 ? 'muted ' : ''}${base}`; };
/* the kit's own colours: the team's or the store's picks as they are; a site read without a framework's stock ones */
export const kitColours = (bbv = {}) => { const k = bbv.kit || {}, all = (k.colors || []).filter((c) => /^#[0-9a-f]{3,8}$/i.test(String(c || '')));
  return k.colorsBy === 'team' || bbv.src?.['kit.colors'] ? all : all.filter((c) => !UI_DEFAULTS.has(String(c).toLowerCase())); };
/* a direction for the maker as whole sentences, at most n characters: the brand's rules (its colours and its Never list) always stay,
   whole, and the other sentences go from the end, never cut mid-word or mid-rule (26 Oct, QV N-P1-5: tidy(…, 600) dropped the colours
   and the Never rules of every set-up with three or more styles, on screen and in what the maker read) */
const RULE = /^(?:In the brand[’']s\b|In the brand colou?rs\b|No brand colou?rs\b|Never:)/i;
const sentences = (s) => String(s || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?…][”’"')]*)\s+(?=[A-Z“"‘(#0-9])/).filter(Boolean);
export const fitDirection = (s, n = 900) => { const xs = sentences(s); if (!xs.length) return ''; const rules = xs.filter((x) => RULE.test(x)); let room = n - rules.join(' ').length;
  const keep = new Set(rules); for (const x of xs) { if (keep.has(x)) continue; if (x.length + 1 > room) break; keep.add(x); room -= x.length + 1; }
  return xs.filter((x) => keep.has(x)).join(' '); };
/* a direction saved before 26 Oct, healed on read (free): a framework's stock blues and any hex said in words, the brand's own only
   ("In the brand colours #82b1ff, #3b82f6, #34" → "In the brand’s light blue."), and the joins that read wrong (".;", "wash.”.") (QV P1-17) */
const HEX6 = /#[0-9a-f]{6}\b/gi;
const namesOf = (hexes, mine = false) => { const ns = [...new Set(hexes.filter((h) => /^#[0-9a-f]{3,8}$/i.test(h) && (mine || (h.length === 7 && !UI_DEFAULTS.has(h.toLowerCase())))).map(colourName).filter(Boolean))].slice(0, 3); return ns.length > 1 ? `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}` : ns[0] || ''; };
export const healDirection = (s, own = []) => { if (typeof s !== 'string' || !s) return s; /* own: the brand's kit colours (kitColours), said in their place when known */
  let x = s.replace(/In the brand(?:[’']s)? colou?rs?:?\s*((?:#[0-9a-f]{1,8}\b[\s,]*(?:and\s+)?)+)[^.]*?(?:\.|$)/gi, (m, list) => { const nm = (own || []).length ? namesOf(own, true) : namesOf(list.match(/#[0-9a-f]{1,8}\b/gi) || []); return nm ? `In the brand’s ${nm}.` : 'No brand colours in the Brand Book yet: the colours follow the product photo.'; });
  x = x.replace(HEX6, (h) => (UI_DEFAULTS.has(h.toLowerCase()) ? '' : colourName(h) || ''));
  x = x.replace(/([.!?])\s*;\s*/g, '$1 ').replace(/([.!?])([”’"])\./g, '$1$2').replace(/\.{2,}(?!\.)/g, '.').replace(/\s+([,.;:])/g, '$1').replace(/,\s*(?=[.;])/g, '').replace(/\s{2,}/g, ' ').trim();
  return x; };
