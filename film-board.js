/* The founder storyboard: a film brief (creative.film_brief) drawn as the film it will be.
   Every shot gets a frame, a time and its line; the spoken lines become the script the founder reads on camera
   (the teleprompter in public/film-board.js), the .srt and the shoot brief in the pack.
   Brew never makes an AI founder: a person shot is drawn as a sketch for the real person to film. */

export const isFilm = (ch) => ch?.family === 'brief' && ch?.action === 'creative.film_brief';

const PERSON = /\b(founder|co-?founder|ceo|to camera|talking|talks?|speaks?|says|selfie|face|creator|presenter|host|interview|testimonial|customer|vlog|piece to camera|ptc)\b/i;
const HANDS = /\b(hands?|appl(y|ies|ying)|pour|unbox|holds?|holding|squeez|rub|scoop|spray|open(s|ing)? the)\b/i;
const PRODUCT = /\b(pack ?shot|product|bottle|jar|tube|pack|box|close-?up|logo|end (card|frame)|price|label|flat ?lay)\b/i;
const TBC = /^(to confirm|tbc|tbd|-|none)?$/i;
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const half = (n) => Math.round(n * 2) / 2;

/* the length asked for: the brief's own words ("a 30-second film", "One 15s film"), then the knob, then 30 s */
export const lengthOf = (ch) => { const p = ch?.pkg || {}, txt = [p.title, ...(Array.isArray(p.deliverables) ? p.deliverables : [])].join(' ');
  const m = /(\d{1,3})\s*(?:-|\s)?\s*(?:s\b|sec|second)/i.exec(txt) || /(\d{1,3})s\b/i.exec(String(ch?.knobs?.length || ''));
  const n = m ? +m[1] : 30; return Math.min(180, Math.max(6, n)); };

export const whoOf = (shot, line = '') => (PERSON.test(shot) ? 'person' : HANDS.test(shot) ? 'hands' : PRODUCT.test(shot) ? 'product' : PERSON.test(line) && /^["“]/.test(line) ? 'person' : 'scene');

const stamp = (s) => { const ms = Math.round(s * 1000), h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60, x = Math.floor(ms / 1000) % 60, r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')},${String(r).padStart(3, '0')}`; };

/* a writer that put every shot in one row ("Shot 1: Founder to camera. Line: '…' | Shot 2: …") is read back as one row per shot */
const SHOT = /(?:^|\s|\|)\s*Shot\s*\d+\s*[:.-]\s*/i;
export const splitRows = (rows) => rows.flatMap((r) => { const all = [r?.shot, r?.line].filter(Boolean).join(' | ');
  if (!r || (all.match(new RegExp(SHOT.source, 'gi')) || []).length < 2) return [r];
  return all.split(new RegExp(SHOT.source, 'i')).map((x) => x.replace(/^\s*\|\s*|\s*\|\s*$/g, '').trim()).filter(Boolean).map((x) => {
    const m = /^(.*?)[.\s|]*\bLine\s*:\s*(.*)$/is.exec(x); const shot = (m ? m[1] : x).replace(/[.\s|]+$/, '').trim(), line = (m ? m[2] : '').replace(/^\s*['‘]|['’]\s*\.?\s*$/g, '').trim();
    return { shot, line: line && /^[A-Z]/.test(line) && PERSON.test(shot) ? `“${line.replace(/^["“]|["”]$/g, '')}”` : line }; }); });

/* the board: shots timed to the length (longer lines get more time: ~2.5 spoken words a second, at least 2 s a shot) */
export function boardOf(ch, { card = {} } = {}) {
  if (!isFilm(ch)) return null;
  const p = ch.pkg || {}, rows = splitRows(Array.isArray(p.scenes) ? p.scenes : []).filter((r) => r && (r.shot || r.line)).slice(0, 10);
  if (!rows.length) return null;
  const total = lengthOf(ch), all = [p.title, p.talent, card.title, card.subtitle, ...rows.map((r) => r.shot)].join(' ');
  const founder = /\bfounders?\b|co-?founder/i.test(all);
  const talent = !TBC.test(String(p.talent || '').trim()) ? String(p.talent).trim() : founder ? 'The founder' : 'Whoever is on camera';
  const need = rows.map((r) => Math.max(2, words(r.line) / 2.5)), sum = need.reduce((a, b) => a + b, 0);
  let at = 0;
  const shots = rows.map((r, i) => { const who = whoOf(r.shot, r.line), sec = i === rows.length - 1 ? Math.max(1, half(total - at)) : Math.max(1, half(need[i] / sum * total));
    const s = { n: i + 1, from: at, to: Math.min(total, at + sec), sec, shot: String(r.shot || ''), line: String(r.line || ''), who, say: who === 'person' }; at = s.to; return s; });
  /* nobody on camera in any shot: the lines are a voiceover the founder (or a teammate) records */
  const vo = !shots.some((s) => s.say);
  const read = shots.filter((s) => (vo ? s.line : s.say && s.line));
  const script = read.map((s) => s.line.replace(/^["“]|["”]$/g, '')).join('\n\n');
  const srt = shots.filter((s) => s.line).map((s, k) => `${k + 1}\n${stamp(s.from)} --> ${stamp(s.to)}\n${s.line.replace(/^["“]|["”]$/g, '')}\n`).join('\n');
  return { v: 1, total, talent, founder, vo, format: (/(9:16|4:5|1:1|16:9)/.exec([(p.deliverables || [])[0], p.title].join(' ')) || [, '9:16'])[1], shots, script, srt, readSec: Math.round(words(script) / 2.5) };
}
