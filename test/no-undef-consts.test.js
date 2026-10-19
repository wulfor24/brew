// A constant used without being declared or imported throws only when its line runs (19 Oct: feed-service read PLAN_V without
// importing it, so the jam list threw for any jam with a saved plan, and every other test passed). Every server and page script
// is parsed and each ALL_CAPS name it reads must be declared, imported or a known global in that file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let acorn = null, walk = null;
try { acorn = await import('acorn'); walk = await import('acorn-walk'); } catch {}
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const files = [...fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')), ...['reader', 'public'].flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`) : []))];
const GLOBALS = new Set(['JSON', 'URL', 'NaN', 'BREW_DEMO', 'BREW_MONEY', 'FEED_DATA', 'BREW_FACTS', 'BREW_SEED', 'BREW_V', 'BREW_LIVE', 'BREW_CONFIG', 'DOMParser', 'CSS', 'HTML']);
const pat = (n, out) => { if (!n) return; if (n.type === 'Identifier') out.add(n.name); else if (n.type === 'ObjectPattern') n.properties.forEach((p) => pat(p.type === 'RestElement' ? p.argument : p.value, out)); else if (n.type === 'ArrayPattern') n.elements.forEach((e) => pat(e, out)); else if (n.type === 'AssignmentPattern') pat(n.left, out); else if (n.type === 'RestElement') pat(n.argument, out); };

test('every ALL_CAPS name a script reads is declared, imported or a known global there', { skip: !acorn && 'acorn not installed' }, () => {
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8'); let ast;
    try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowAwaitOutsideFunction: true }); } catch { try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }); } catch { continue; } }
    const declared = new Set(), used = new Map();
    walk.full(ast, (n) => {
      if (n.type === 'ImportSpecifier' || n.type === 'ImportDefaultSpecifier' || n.type === 'ImportNamespaceSpecifier') declared.add(n.local.name);
      else if (n.type === 'VariableDeclarator') pat(n.id, declared);
      else if (n.type === 'ClassDeclaration' && n.id) declared.add(n.id.name);
      else if (/Function/.test(n.type)) { n.params.forEach((p) => pat(p, declared)); if (n.id) declared.add(n.id.name); }
      else if (n.type === 'CatchClause' && n.param) pat(n.param, declared);
    });
    walk.ancestor(ast, { Identifier(n, st, anc) { if (!/^[A-Z][A-Z0-9_]+$/.test(n.name)) return; const p = anc[anc.length - 2];
      if (p && p.type === 'MemberExpression' && p.property === n && !p.computed) return; if (p && (p.type === 'Property' || p.type === 'PropertyDefinition' || p.type === 'MethodDefinition') && p.key === n && !p.computed && !p.shorthand) return;
      if (p && (p.type === 'ExportSpecifier' || p.type === 'LabeledStatement' || p.type === 'BreakStatement' || p.type === 'ContinueStatement')) return;
      if (!used.has(n.name)) used.set(n.name, n.start); } });
    for (const [name, at] of used) if (!declared.has(name) && !GLOBALS.has(name) && !(name in globalThis)) bad.push(`${f}:${src.slice(0, at).split('\n').length} reads ${name}, never declared or imported`);
  }
  assert.deepEqual(bad, []);
});
