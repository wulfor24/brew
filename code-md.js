// Code a writer puts in its words (a ```json JSON-LD block, a Liquid snippet, an llms.txt) is code, never prose: every place
// that lays words out (the draft mocks, the shared brief page, the publish pack) splits it out first and shows it as a code
// block, so a "```json" line is never printed as a paragraph. Every family and every brand; the browser has its own copy of
// splitCode in public/app.js and public/jam-room.js (no shared modules there).

/* the words → [{ code: false, text }, { code: true, lang, text }]. A fence left open (a writer cut off) is code to the end */
export function splitCode(s) {
  const out = []; let buf = [], code = null;
  const push = () => {
    const text = buf.join('\n'); buf = [];
    if (code) { const t = text.replace(/^\s*\n|\n\s*$/g, ''); if (t.trim()) out.push({ code: true, lang: code.lang, text: t }); }
    else if (text.trim()) out.push({ code: false, text });
  };
  for (const line of String(s ?? '').replace(/\r/g, '').split('\n')) {
    const m = /^\s*```\s*([\w+#./-]*)/.exec(line);
    if (m) { push(); code = code ? null : { lang: m[1].toLowerCase() }; continue; }
    buf.push(line);
  }
  push(); return out;
}
export const hasCode = (s) => /(^|\n)\s*```/.test(String(s ?? ''));
export const codeBlocks = (s) => splitCode(s).filter((x) => x.code);
/* a block's file extension, from its fence's language (a JSON-LD block is .json) */
export const codeExt = (lang = '') => ({ json: 'json', 'ld+json': 'json', jsonld: 'json', 'json-ld': 'json', html: 'html', liquid: 'liquid', js: 'js', javascript: 'js', css: 'css', xml: 'xml', md: 'md', markdown: 'md', yaml: 'yml', yml: 'yml' }[String(lang).toLowerCase()] || 'txt');
const escH = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export const codePre = (b, esc = escH) => `<pre class="code"${b.lang ? ` data-lang="${esc(b.lang)}"` : ''}><code>${esc(b.text)}</code></pre>`;
/* plain words as HTML paragraphs, code as code blocks (the pack's page sections and FAQ answers) */
export const wordsHtml = (s, esc = escH) => splitCode(s).map((x) => x.code ? codePre(x, esc) : x.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('\n')).join('\n');
