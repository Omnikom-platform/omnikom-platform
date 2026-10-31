// The design-tell reader for the DSN rules (slice 4b). Node built-ins only, nothing here judges a page: the checks do.
// scanPage(site, page) reads the page's HTML again, element by element, because the page reader (site.mjs) keeps headings, links and
// blocks but not classes, inline styles or <style> blocks. Text inside svg, template, noscript, script, style and comments is never
// seen (those regions are blanked, keeping their newlines, so every line number stays true); text in <head> and <title> is not
// "visible text" and is not seen either.
//   scan = { elements[{i, tag, attrs, line, parent, ns, ne}], nodes[{t, line, owner, boundary}], sheets[{file, line, parsed}],
//            classes(el), textOf(el), textMatches(el, re), bodyMatches(re), css(el), effective(el, prop), keyframes[{name, file, line}] }
// CSS sources of an element: the page's <style> blocks and, in a built folder only, the local stylesheets the page links (a snapshot
// does not carry its stylesheets). A selector is matched only when it is ONE plain class (.card) or ONE element name (h2), alone or in a
// comma list; anything with a combinator, pseudo-class, attribute, id or compound part is not judged. Cascade: element rules, then class
// rules, then the inline style attribute; a later declaration of the same property wins; specificity and media queries are not computed.
import { decode } from "./site.mjs";
import { lineAt } from "./lines.mjs";

// The source of a DSN rule: the line(s) of the unslop copy in this repo (skills/unslop/, CC BY 4.0, Damir Sokolovsky) and the owner decision.
export const dsnSource = (where) => `${where}; planning/DECISIONS.md 37 (owner, 2026-10-31); unslop by Damir Sokolovsky, CC BY 4.0`;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// tags that end a run of visible text (a boundary is put in the text stream before and after them)
const BLOCKY = new Set(["address", "article", "aside", "blockquote", "body", "br", "button", "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "option", "p", "pre", "section", "select", "summary", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "tr", "ul"]);
const P_CLOSERS = new Set(["address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]);
const IMPLIED = { li: ["li", "p"], dt: ["dt", "dd", "p"], dd: ["dt", "dd", "p"], option: ["option"], tr: ["tr", "td", "th", "p"], td: ["td", "th", "p"], th: ["td", "th", "p"] };

const nl = (s) => s.replace(/[^\n]/g, "");
const attrOf = (raw) => { const o = {}; raw.replace(/([\w:@.\[\]-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g, (m, k, a, b, c) => { o[k.toLowerCase()] = decode(a ?? b ?? c ?? ""); return m; }); return o; };

// ---- CSS ----------------------------------------------------------------------------------------------------------------------------
// parseCss(text, firstLine) -> { rules: [{ selectors[], decls[{prop, value, line}], line }], keyframes: [{ name, line }] }
export function parseCss(src, firstLine = 1) {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, (m) => nl(m));
  const breaks = []; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) breaks.push(i);
  const lineOf = (pos) => { let lo = 0, hi = breaks.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (breaks[mid] < pos) lo = mid + 1; else hi = mid; } return firstLine + lo; };
  const out = { rules: [], keyframes: [] };
  // index just after the closing brace that matches the open brace at `open` (strings and parentheses respected)
  const skipBlock = (open) => {
    let depth = 0, q = null;
    for (let i = open; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === "\\") i++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") q = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) return i + 1; }
    }
    return text.length;
  };
  const parseDecls = (body, start) => {
    const decls = [];
    let depth = 0, q = null, cur = "", curStart = start;
    const flush = () => {
      const m = /^\s*([-\w]+)\s*:([\s\S]*)$/.exec(cur);
      if (m && !/[{}]/.test(cur)) decls.push({ prop: m[1].toLowerCase(), value: m[2].replace(/!\s*important/i, "").replace(/\s+/g, " ").trim(), line: lineOf(curStart + cur.search(/\S|$/)) });
      cur = "";
    };
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (q) { cur += ch; if (ch === "\\") { cur += body[++i] || ""; } else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === "(") depth++; else if (ch === ")") depth--;
      if (ch === "{") { // a nested rule (CSS nesting): skip it, it is not a declaration
        let d = 0, j = i;
        for (; j < body.length; j++) { if (body[j] === "{") d++; else if (body[j] === "}") { d--; if (d === 0) break; } }
        cur = ""; i = j; curStart = start + i + 1; continue;
      }
      if (ch === ";" && depth <= 0) { flush(); curStart = start + i + 1; continue; }
      cur += ch;
    }
    flush();
    return decls;
  };
  const parseSeq = (from, to) => {
    let i = from;
    while (i < to) {
      while (i < to && /\s/.test(text[i])) i++;
      if (i >= to) break;
      const start = i;
      let q = null, depth = 0, stop = -1;
      for (; i < to; i++) {
        const ch = text[i];
        if (q) { if (ch === "\\") i++; else if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'") q = ch;
        else if (ch === "(") depth++; else if (ch === ")") depth--;
        else if ((ch === "{" || ch === ";") && depth <= 0) { stop = i; break; }
      }
      if (stop < 0) break;
      const prelude = text.slice(start, stop).trim();
      if (text[stop] === ";") { i = stop + 1; continue; } // @import, @charset
      const end = skipBlock(stop);
      const body = text.slice(stop + 1, end - 1);
      if (prelude.startsWith("@")) {
        const name = /^@([-\w]+)/.exec(prelude)[1].toLowerCase();
        if (/keyframes$/.test(name)) out.keyframes.push({ name: prelude.slice(name.length + 1).trim(), line: lineOf(start) });
        else if (["media", "supports", "layer", "container", "document", "scope"].includes(name)) parseSeq(stop + 1, end - 1);
      } else {
        out.rules.push({ selectors: prelude.split(",").map((x) => x.trim()).filter(Boolean), decls: parseDecls(body, stop + 1), line: lineOf(start) });
      }
      i = end;
    }
  };
  parseSeq(0, text.length);
  return out;
}

// The class names and element names a plain selector list can be matched to, exactly: [{ kind: "class"|"tag", key }]
export function plainSelectors(selectors) {
  const out = [];
  for (const s of selectors) {
    let m;
    if ((m = /^\.(-?[_a-zA-Z][\w-]*)$/.exec(s))) out.push({ kind: "class", key: m[1] });
    else if ((m = /^([a-zA-Z][\w-]*)$/.exec(s))) out.push({ kind: "tag", key: m[1].toLowerCase() });
  }
  return out;
}

export function parseInlineStyle(style, line) {
  return parseCss(`x{${String(style).replace(/\n/g, " ")}}`, line).rules.flatMap((r) => r.decls.map((d) => ({ ...d, line })));
}

// ---- the page --------------------------------------------------------------------------------------------------------------------------
const PAGE_CACHE = new WeakMap();
const SHEET_CACHE = new WeakMap(); // site -> Map(rel -> parsed | null)

function localStylesheet(site, page, href) {
  if (site.mode !== "static") return null;
  let u;
  try { u = new URL(href, "https://site.invalid/" + String(page.file || "").replace(/^\/+/, "")); } catch { return null; }
  if (u.hostname !== "site.invalid" && !(site.hosts || []).map((x) => x.replace(/^www\./, "")).includes(u.hostname.replace(/^www\./, ""))) return null;
  let p = u.pathname;
  try { p = decodeURIComponent(p); } catch {}
  p = p.replace(/^\/+/, "");
  return p && site.has(p) ? p : null;
}

export function scanPage(site, page) {
  const cached = PAGE_CACHE.get(page);
  if (cached) return cached;
  const before0 = String(page.raw || "");
  let html = before0.replace(/<!--[\s\S]*?-->/g, (m) => " " + nl(m));
  html = html.replace(/<(script|template|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi, (m) => " " + nl(m));
  html = html.replace(/<[!?][^>]*>/g, (m) => " " + nl(m));
  const styleBlocks = [];
  const beforeStyle = html;
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (m, css, off) => {
    const id = styleBlocks.length;
    styleBlocks.push({ text: css, line: lineAt(beforeStyle, off + m.indexOf(">") + 1) });
    return `<x-style i="${id}"${nl(m)}>`;
  });

  const elements = [], nodes = [], stack = [], order = [];
  let inHead = false, ln = 1, ptr = 0, titleDepth = 0;
  const lineTo = (idx) => { while (ptr < idx) { if (html.charCodeAt(ptr++) === 10) ln++; } return ln; };
  const top = () => (stack.length ? stack[stack.length - 1] : -1);
  const pushNode = (t, line, boundary = false) => nodes.push({ t, line, owner: top(), boundary });
  const re = /<(\/)?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(html))) {
    const line = lineTo(m.index);
    if (m[4] !== undefined) {
      if (inHead || titleDepth > 0) continue;
      m[4].split("\n").forEach((piece, k) => {
        let s = decode(piece).replace(/\s+/g, " ");
        if (k > 0) s = " " + s;
        if (s !== "") pushNode(s, line + k);
      });
      continue;
    }
    const close = !!m[1], tag = m[2].toLowerCase(), rawAttrs = m[3] || "";
    if (tag === "x-style") { if (!close) order.push({ kind: "inline", id: +/i="(\d+)"/.exec(rawAttrs)[1] }); continue; }
    if (!close) {
      const attrs = attrOf(rawAttrs);
      if (tag === "head") inHead = true;
      if (tag === "body") inHead = false;
      const closers = P_CLOSERS.has(tag) ? ["p"] : IMPLIED[tag];
      if (closers) while (stack.length && closers.includes(elements[top()].tag)) { const e = elements[stack.pop()]; e.ne = nodes.length; if (e.tag === "title") titleDepth--; }
      if (tag === "link" && /\bstylesheet\b/i.test(attrs.rel || "") && attrs.href) order.push({ kind: "link", href: attrs.href });
      const el = { i: elements.length, tag, attrs, line, parent: top(), ns: nodes.length, ne: -1 };
      elements.push(el);
      if (BLOCKY.has(tag)) pushNode("\n", line, true);
      if (VOID.has(tag) || /\/\s*$/.test(rawAttrs)) el.ne = nodes.length;
      else { stack.push(el.i); if (tag === "title") titleDepth++; }
    } else {
      if (tag === "head") inHead = false;
      const k = stack.findLastIndex((i) => elements[i].tag === tag);
      if (k < 0) continue;
      while (stack.length > k) { const e = elements[stack.pop()]; e.ne = nodes.length; if (e.tag === "title") titleDepth--; }
      if (BLOCKY.has(tag)) pushNode("\n", line, true);
    }
  }
  while (stack.length) { const e = elements[stack.pop()]; e.ne = nodes.length; }

  // the style sources in document order
  if (!SHEET_CACHE.has(site)) SHEET_CACHE.set(site, new Map());
  const fileCache = SHEET_CACHE.get(site);
  const sheets = [];
  for (const o of order) {
    if (o.kind === "inline") { const b = styleBlocks[o.id]; sheets.push({ file: null, line: b.line, parsed: parseCss(b.text, b.line) }); continue; }
    const rel = localStylesheet(site, page, o.href);
    if (!rel) continue;
    if (!fileCache.has(rel)) { let p = null; try { p = parseCss(site.read(rel), 1); } catch { p = null; } fileCache.set(rel, p); }
    if (fileCache.get(rel)) sheets.push({ file: rel, line: 1, parsed: fileCache.get(rel) });
  }
  const byClass = new Map(), byTag = new Map();
  for (const sh of sheets) {
    for (const r of sh.parsed.rules) {
      for (const sel of plainSelectors(r.selectors)) {
        const map = sel.kind === "class" ? byClass : byTag;
        if (!map.has(sel.key)) map.set(sel.key, []);
        map.get(sel.key).push({ decls: r.decls, where: sh.file ? `${sh.file}:${r.line}` : `<style> line ${r.line}` });
      }
    }
  }
  const keyframes = sheets.flatMap((sh) => sh.parsed.keyframes.map((k) => ({ name: k.name, file: sh.file, line: k.line })));

  const classCache = new Map(), cssCache = new Map();
  const classes = (el) => { if (!classCache.has(el.i)) classCache.set(el.i, String(el.attrs.class || "").split(/\s+/).filter(Boolean)); return classCache.get(el.i); };
  // every declaration that reaches the element, in cascade order: [{ prop, value, where, line }]
  const css = (el) => {
    if (cssCache.has(el.i)) return cssCache.get(el.i);
    const out = [];
    for (const r of byTag.get(el.tag) || []) for (const d of r.decls) out.push({ ...d, where: r.where });
    for (const c of classes(el)) for (const r of byClass.get(c) || []) for (const d of r.decls) out.push({ ...d, where: r.where });
    if (el.attrs.style) for (const d of parseInlineStyle(el.attrs.style, el.line)) out.push({ ...d, where: "style attribute" });
    cssCache.set(el.i, out);
    return out;
  };
  const effective = (el, ...props) => { const l = css(el).filter((d) => props.includes(d.prop)); return l.length ? l[l.length - 1] : null; };

  const joinNodes = (from, to) => nodes.slice(from, to).map((n) => n.t).join("");
  const textOf = (el) => joinNodes(el.ns, el.ne).replace(/\s+/g, " ").trim();
  // matches of `re` in the text of an element or of the whole body: [{ text, line }] (the line of the node the match starts in)
  const scanText = (from, to, re) => {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    const starts = []; let acc = "";
    for (let k = from; k < to; k++) { starts.push(acc.length); acc += nodes[k].t; }
    const out = [];
    let mm;
    while ((mm = g.exec(acc))) {
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= mm.index) lo = mid; else hi = mid - 1; }
      out.push({ text: mm[0], index: mm.index, line: nodes[from + lo] ? nodes[from + lo].line : 1 });
      if (mm[0] === "") g.lastIndex++;
    }
    return out;
  };
  const textMatches = (el, r) => scanText(el.ns, el.ne, r);
  const bodyMatches = (r) => scanText(0, nodes.length, r);

  const scan = { elements, nodes, sheets, keyframes, classes, css, effective, textOf, textMatches, bodyMatches };
  PAGE_CACHE.set(page, scan);
  return scan;
}

// ---- Tailwind class reading (shared by several checks) ---------------------------------------------------------------------------
// "md:hover:!scale-105" -> { variants: ["md", "hover"], utility: "scale-105" } (a colon inside [...] is not a separator)
export function splitToken(token) {
  const parts = []; let depth = 0, cur = "";
  for (const ch of token) {
    if (ch === "[") depth++; else if (ch === "]") depth--;
    if (ch === ":" && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  const utility = parts.pop().replace(/^!/, "").replace(/!$/, "");
  return { variants: parts, utility };
}

// A length in px: "12px" is 12, "0.75rem" is 12 (rem at 16 px), a bare 0 is 0; null for anything else (em, %, calc, var, a colour).
export function lengthPx(v) {
  const m = /^(-?\d*\.?\d+)(px|rem)?$/.exec(String(v).trim().toLowerCase());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!m[2]) return n === 0 ? 0 : null;
  return m[2] === "rem" ? n * 16 : n;
}
