// The plan gate (DECISIONS 44): nothing on the dashboard is made up. A static scan of the app source against the Id and Slice columns of
// docs/blueprint/16-DESIGN-PARTS.md. It fails on:
//   PLAN-1  an interactive or copy element with no data-plan (itself or an ancestor element in the same file)
//   PLAN-2  a data-plan / t() id that is not in the plan
//   PLAN-3  a row of a built slice that no element carries
//   PLAN-4  a string literal that is not in its row (words are matched whole, case-insensitively)
//   PLAN-5  prose in code outside a data-plan element, a t() call, an Error or a console call
//   PLAN-6  a control with no handler, or a link to a route that does not exist
//   PLAN-7  a placeholder tell: lorem ipsum, John/Jane Doe, Acme, a 555 number, an example.com address, a bare number as text
//   PLAN-8  words in index.html
//   PLAN-9  a row whose slice is not built yet, on a screen (no dead controls)
// The DOM half of the gate (the rendered screens) is tests/plan-gate.dom.ts, run by the Playwright flows.
import { readFileSync } from 'node:fs';
import { parseAst } from 'vite';

export const BUILT_SLICES_FILE = new URL('../built-slices.json', import.meta.url);

/** The plan: Map id -> { id, slice, text (the whole row, lower-cased, spaces collapsed) }. */
export function readPlan(markdown) {
  const plan = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\|\s*(DP-[0-9a-z.]+-\d+)\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if (m) plan.set(m[1], { id: m[1], slice: m[2], text: norm(line) });
  }
  return plan;
}

export const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** Is `text` in the row as whole words (so "Mark" is not in "Marked")? */
export function inRow(text, row) {
  const n = norm(text);
  if (!n) return true;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(row.text);
}

const INTERACTIVE = new Set(['button', 'a', 'input', 'select', 'textarea', 'form', 'dialog', 'details', 'summary', 'Link']);
const TEXT_ATTRS = new Set(['aria-label', 'placeholder', 'title', 'alt', 'aria-description', 'label']);
const PROSE = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/;
const HAS_WORD = /[A-Za-z0-9]/;
const TELLS = [
  [/lorem|ipsum/i, 'lorem ipsum'],
  [/\b(john|jane)\s+(doe|smith)\b/i, 'an example name (John/Jane Doe)'],
  [/\bacme\b/i, 'Acme'],
  [/\(555\)|\b555[-. ]\d{3,4}\b/, 'a 555 number'],
  [/@example\.(com|org|net)\b/i, 'an example.com address'],
];

const lineOf = (code, pos) => code.slice(0, pos).split('\n').length;

function jsxName(n) { return n && n.type === 'JSXIdentifier' ? n.name : null; }

function attrMap(open) {
  const m = {};
  for (const a of open.attributes) if (a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier') m[a.name.name] = a;
  return m;
}

const strLit = n => (n && n.type === 'Literal' && typeof n.value === 'string' ? n.value : null);

/** The string literals an expression can render: a literal, a template's fixed parts, either branch of ?: , either side of || && ??. */
function rendered(expr) {
  if (!expr) return [];
  if (expr.type === 'Literal' && typeof expr.value === 'string') return [{ node: expr, text: expr.value }];
  if (expr.type === 'TemplateLiteral') return expr.quasis.map(q => ({ node: q, text: q.value.cooked ?? q.value.raw })).filter(x => x.text);
  if (expr.type === 'ConditionalExpression') return [...rendered(expr.consequent), ...rendered(expr.alternate)];
  if (expr.type === 'LogicalExpression') return [...rendered(expr.left), ...rendered(expr.right)];
  if (expr.type === 'ParenthesizedExpression') return rendered(expr.expression);
  return [];
}

/** Every route path of the router file, from its createRoute calls: Set of '/w/$ws/leads' style paths. */
export function routePaths(code) {
  const ast = parseAst(code, { lang: 'tsx' });
  const routes = new Map();
  const find = n => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(find); return; }
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init?.type === 'CallExpression' && n.init.callee?.type === 'Identifier'
      && (n.init.callee.name === 'createRoute' || n.init.callee.name === 'createRootRoute')) {
      const o = n.init.arguments[0];
      const r = { parent: null, path: null, id: null };
      for (const p of o?.properties ?? []) {
        const k = p.key?.name ?? p.key?.value;
        if (k === 'path') r.path = strLit(p.value);
        if (k === 'id') r.id = strLit(p.value);
        if (k === 'getParentRoute' && p.value?.body?.type === 'Identifier') r.parent = p.value.body.name;
      }
      routes.set(n.id.name, r);
    }
    for (const k of Object.keys(n)) if (k !== 'type') find(n[k]);
  };
  find(ast);
  const full = name => {
    const r = routes.get(name);
    if (!r) return '';
    const base = r.parent ? full(r.parent) : '';
    if (r.path === null || r.path === '' || r.path === '/') return base;
    return `${base}/${r.path.replace(/^\/+|\/+$/g, '')}`;
  };
  return new Set([...routes.keys()].map(k => full(k) || '/'));
}

const normRoute = p => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/';

/**
 * Scan the source. files: [{ path, code }] (the app's src, no tests); plan: readPlan(); built: ['5.3']; routes: Set from routePaths();
 * indexHtml: the text of index.html (optional). Returns [{ rule, file, line, message }].
 */
export function scanSources({ files, plan, built, routes, indexHtml }) {
  const problems = [];
  const used = new Set();
  const inAnyRow = text => [...plan.values()].some(r => inRow(text, r));

  for (const file of files) {
    const { path, code } = file;
    const report = (rule, node, message) => problems.push({ rule, file: path, line: node ? lineOf(code, node.start ?? 0) : 0, message });
    let ast;
    try { ast = parseAst(code, { lang: path.endsWith('x') ? 'tsx' : 'ts' }); }
    catch (e) { report('PLAN-5', null, `cannot parse: ${String(e.message || e).slice(0, 100)}`); continue; }
    const accounted = new Set();

    const tell = (text, node) => {
      if (inAnyRow(text)) return;
      for (const [re, what] of TELLS) if (re.test(text)) report('PLAN-7', node, `placeholder tell (${what}) in "${text.slice(0, 40)}"`);
    };
    const checkId = (id, node) => {
      if (!plan.has(id)) { report('PLAN-2', node, `${id} is not in the plan`); return false; }
      used.add(id);
      const row = plan.get(id);
      if (!built.includes(row.slice)) report('PLAN-9', node, `${id} is a row of slice ${row.slice}, which is not built`);
      return true;
    };
    const copy = (text, node, scope) => {
      const t = text.replace(/\s+/g, ' ').trim();
      if (!HAS_WORD.test(t)) return;
      tell(t, node);
      if (/^\d+$/.test(t)) { report('PLAN-7', node, `a bare number as text (${t}): a count must come from data`); return; }
      if (!scope.plan) { report('PLAN-1', node, `copy "${t.slice(0, 50)}" is outside any data-plan element`); return; }
      const row = plan.get(scope.plan);
      if (row && !inRow(t, row)) report('PLAN-4', node, `"${t.slice(0, 60)}" is not in the words of ${scope.plan}`);
    };
    const routeCheck = (value, node) => {
      if (value.startsWith('/') && !routes.has(normRoute(value))) report('PLAN-6', node, `link to ${value}, which is not a route`);
    };
    const accountAll = n => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(accountAll); return; }
      if (n.type === 'Literal' || n.type === 'TemplateElement') accounted.add(n.start);
      for (const k of Object.keys(n)) if (k !== 'type') accountAll(n[k]);
    };

    const visit = (n, scope) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(c => visit(c, scope)); return; }
      switch (n.type) {
        case 'ImportDeclaration': case 'ExportAllDeclaration': case 'TSLiteralType': case 'TSImportType':
          accountAll(n); return;
        case 'NewExpression':
          if (n.callee?.type === 'Identifier' && n.callee.name === 'Error') accountAll(n.arguments);
          break;
        case 'CallExpression': {
          const c = n.callee;
          if (c?.type === 'MemberExpression' && c.object?.type === 'Identifier' && c.object.name === 'console') accountAll(n.arguments);
          if (c?.type === 'Identifier' && c.name === 't') {
            const id = strLit(n.arguments[0]);
            if (id === null) report('PLAN-2', n, 't() needs the plan id as a string literal');
            else if (checkId(id, n)) {
              const row = plan.get(id);
              const parts = rendered(n.arguments[1]);
              accountAll(n.arguments);
              if (!parts.length) report('PLAN-4', n, `t(${id}) needs its words as a string literal`);
              for (const p of parts) {
                const text = p.text.replace(/\s+/g, ' ').trim();
                if (!HAS_WORD.test(text)) continue;
                tell(text, p.node);
                if (!inRow(text, row)) report('PLAN-4', p.node, `"${text.slice(0, 60)}" is not in the words of ${id}`);
              }
            }
          }
          break;
        }
        case 'Property': {
          const k = n.key?.name ?? n.key?.value;
          if (k === 'to') for (const p of rendered(n.value)) { routeCheck(p.text, p.node); accounted.add(p.node.start); }
          break;
        }
        case 'JSXElement': {
          const open = n.openingElement;
          const name = jsxName(open.name);
          const attrs = attrMap(open);
          let own;
          if (attrs['data-plan']) {
            own = strLit(attrs['data-plan'].value);
            if (own === null) report('PLAN-2', n, 'data-plan must be a string literal');
            else { checkId(own, n); }
          }
          const inner = { plan: own ?? scope.plan, submitOk: scope.submitOk || (name === 'form' && Boolean(attrs.onSubmit)) };
          const interactive = (name && INTERACTIVE.has(name)) || attrs.onClick || strLit(attrs.role?.value) === 'button';
          if (interactive && !own && !scope.plan) report('PLAN-1', n, `<${name}> has no data-plan, itself or in an ancestor`);
          if (name === 'button' && !attrs.onClick && !(strLit(attrs.type?.value) === 'submit' && inner.submitOk)) report('PLAN-6', n, '<button> does nothing: no onClick and not a submit of a form with onSubmit');
          if (name === 'form' && !attrs.onSubmit) report('PLAN-6', n, '<form> has no onSubmit');
          if ((name === 'input' || name === 'select' || name === 'textarea') && strLit(attrs.type?.value) !== 'hidden' && !attrs.onChange && !attrs.readOnly && !attrs.disabled) report('PLAN-6', n, `<${name}> has no onChange`);
          if (name === 'a' && !attrs.href) report('PLAN-6', n, '<a> has no href');
          if (name === 'Link' && !attrs.to) report('PLAN-6', n, '<Link> has no to');
          for (const key of ['to', 'href']) {
            if (attrs[key]) {
              const v = attrs[key].value;
              for (const p of v?.type === 'JSXExpressionContainer' ? rendered(v.expression) : v ? [{ node: v, text: strLit(v) ?? '' }] : []) { if (p.text) { routeCheck(p.text, n); if (p.node.start !== undefined) accounted.add(p.node.start); } }
            }
          }
          for (const [attr, a] of Object.entries(attrs)) {
            if (!TEXT_ATTRS.has(attr)) continue;
            const v = a.value;
            const parts = v?.type === 'JSXExpressionContainer' ? rendered(v.expression) : v ? [{ node: v, text: strLit(v) ?? '' }] : [];
            for (const p of parts) { copy(p.text, p.node, inner); accounted.add(p.node.start); }
          }
          for (const a of open.attributes) if (a.type === 'JSXAttribute') visit(a.value?.type === 'JSXExpressionContainer' ? a.value.expression : a.value, inner);
          for (const c of n.children) visit(c, inner);
          return;
        }
        case 'JSXText':
          copy(n.value, n, scope);
          return;
        case 'JSXExpressionContainer':
          for (const p of rendered(n.expression)) { copy(p.text, p.node, scope); accounted.add(p.node.start); }
          visit(n.expression, scope);
          return;
        case 'Literal':
          if (typeof n.value === 'string' && !accounted.has(n.start)) {
            tell(n.value, n);
            if (PROSE.test(n.value)) report('PLAN-5', n, `prose outside a data-plan element or t(): "${n.value.slice(0, 50)}"`);
          }
          return;
        case 'TemplateElement': {
          const text = n.value.cooked ?? n.value.raw ?? '';
          if (!accounted.has(n.start)) { tell(text, n); if (PROSE.test(text)) report('PLAN-5', n, `prose outside a data-plan element or t(): "${text.slice(0, 50)}"`); }
          return;
        }
        default:
      }
      for (const k of Object.keys(n)) if (k !== 'type') visit(n[k], scope);
    };
    visit(ast.body, { plan: undefined, submitOk: false });
  }

  for (const row of plan.values()) {
    if (built.includes(row.slice) && !used.has(row.id)) problems.push({ rule: 'PLAN-3', file: '(plan)', line: 0, message: `${row.id} (slice ${row.slice}) has no element in the app` });
  }
  if (indexHtml !== undefined) {
    const title = /<title>([\s\S]*?)<\/title>/i.exec(indexHtml)?.[1] ?? '';
    const body = indexHtml.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<title>[\s\S]*?<\/title>|<[^>]*>/gi, ' ');
    if (HAS_WORD.test(title) || HAS_WORD.test(body)) problems.push({ rule: 'PLAN-8', file: 'index.html', line: 0, message: 'index.html carries words (the title and the body must be empty: the plan has no wording for them)' });
  }
  return problems;
}

export function loadBuilt() { return JSON.parse(readFileSync(BUILT_SLICES_FILE, 'utf8')); }
