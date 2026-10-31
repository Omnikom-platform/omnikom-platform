// Logic-less templates (a small Mustache subset), so the same partials can move into the platform's build unchanged.
// Ported from E:\Alex Sevilla\draft-site\site\lib\render.mjs 2026-10-31; the same partials move into the platform unchanged.
//   {{a.b}}  value, HTML-escaped        {{{a.b}}}  value, raw (already HTML)        {{.}}  the current list item
//   {{#a}}...{{/a}}  list: once per item (the item is the context); object/true: once; empty/false: skipped
//   {{^a}}...{{/a}}  only when a is empty or false
//   {{?a}}...{{/a}}  once, when a is not empty (a guard around a list: {{?xs}}<ul>{{#xs}}<li>..{{/xs}}</ul>{{/xs}})
//   {{>name}}  another partial, same context
// A missing value throws (a typo in a slot must fail the build, not print an empty hole).
import fs from 'node:fs';
import path from 'node:path';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function lookup(stack, key, where) {
  if (key === '.') return stack[stack.length - 1];
  const [head, ...rest] = key.split('.');
  for (let i = stack.length - 1; i >= 0; i--) {
    const c = stack[i];
    if (c && typeof c === 'object' && head in c) return rest.reduce((o, k) => (o == null ? undefined : o[k]), c[head]);
  }
  throw new Error(`template ${where}: no value for {{${key}}}`);
}

function closeOf(src, name, from) {
  const re = new RegExp(`\\{\\{([#^?/])${name.replace(/\./g, '\\.')}\\}\\}`, 'g');
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(src))) { depth += m[1] === '/' ? -1 : 1; if (!depth) return m; }
  throw new Error(`unclosed {{#${name}}}`);
}

export function render(src, ctx, partials = {}, where = 'page') {
  const stack = Array.isArray(ctx) ? ctx : [ctx];
  let out = '', i = 0;
  const tag = /\{\{(\{?)([#^?>]?)\s*([\w.-]+|\.)\s*\}?\}\}/g;
  while (true) {
    tag.lastIndex = i;
    const m = tag.exec(src);
    if (!m) { out += src.slice(i); break; }
    out += src.slice(i, m.index);
    const [all, raw, kind, key] = m;
    if (kind === '#' || kind === '^' || kind === '?') {
      const end = closeOf(src, key, m.index + all.length);
      const inner = src.slice(m.index + all.length, end.index);
      const v = lookup(stack, key, where);
      const empty = v == null || v === false || v === '' || (Array.isArray(v) && !v.length);
      if (kind === '^') { if (empty) out += render(inner, stack, partials, where); }
      else if (kind === '?') { if (!empty) out += render(inner, stack, partials, where); }
      else if (!empty) {
        if (Array.isArray(v)) v.forEach((item, n) => { out += render(inner, [...stack, { _n: n + 1, _first: n === 0 }, item], partials, where); });
        else out += render(inner, typeof v === 'object' ? [...stack, v] : stack, partials, where);
      }
      i = end.index + end[0].length;
    } else if (kind === '>') {
      if (!(key in partials)) throw new Error(`template ${where}: no partial ${key}`);
      out += render(partials[key], stack, partials, key);
      i = m.index + all.length;
    } else {
      const v = lookup(stack, key, where);
      if (v == null || typeof v === 'object') throw new Error(`template ${where}: {{${key}}} is ${v === null ? 'null' : typeof v}`);
      out += raw ? String(v) : esc(v);
      i = m.index + all.length;
    }
  }
  return out;
}

export function loadPartials(...dirs) {
  const p = {};
  for (const d of dirs) for (const f of fs.readdirSync(d)) if (f.endsWith('.html')) p[f.slice(0, -5)] = fs.readFileSync(path.join(d, f), 'utf8');
  return p;
}
