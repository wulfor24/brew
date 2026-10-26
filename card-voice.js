// A card talks to the brand's team in one voice (QV P2-17, 26 Oct): "Brew saw we have 52 live ads", "Brew saw … our engraving"
// mixed Brew's voice with the brand's. In a sentence that says what Brew saw, the brand is "you": we → you, our → your.
// Drafts written for shoppers keep "our" (they are the brand's own words), so this runs on a card's title, line and rows only.
const SAW = /\bBrew (?:saw|found|noticed|read|counted|checked|heard)\b/;
const swap = (s) => s.replace(/\bwe(['’])(re|ve)\b/gi, (m, q, v) => `${m[0] === 'W' ? 'You' : 'you'}’${v}`)
  .replace(/\b(we) (have|are|were|had|run|sell|ship|offer|make|use|get|lose|need|don't|do not|can|could|should)\b/gi, (m, w, v) => `${w[0] === 'W' ? 'You' : 'you'} ${v}`)
  .replace(/\bour\b/g, 'your').replace(/\bOur\b/g, 'Your').replace(/\bours\b/g, 'yours');
/* each sentence that reports what Brew saw: the words after the verb speak of the brand as "you" */
export const oneVoice = (text) => (typeof text !== 'string' || !SAW.test(text) ? text
  : text.replace(/[^.!?]+[.!?]?/g, (sent) => { const m = SAW.exec(sent); if (!m) return sent; const at = m.index + m[0].length; return sent.slice(0, at) + swap(sent.slice(at)); }));
