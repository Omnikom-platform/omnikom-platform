// ARIA in HTML "allowed roles" table, used by writing-gate.mjs (WG-5) to find the defects Lighthouse and axe report as
// `aria-allowed-role` ("ARIA role should be appropriate for the element"), e.g. <form role="tabpanel">.
// Source: the W3C "ARIA in HTML" allowed-roles table, as the lead wrote it down for the writing gate (2026-10-29). An element that
// is not in the table allows any role (no claim is made about it). An element's own implicit role is always allowed (axe does the
// same: <main role="main"> is redundant, not wrong).
// Usage: import { checkRole, parseAttrs, startTags } from "./lib-aria-roles.mjs";
//   checkRole("form", { role: "tabpanel" }) -> { role: "tabpanel", allowed: "search none presentation" } ; null when the role is fine.
export const ANY = null; // "any role allowed"

const L = (s) => s.split(/\s+/).filter(Boolean);
const DOC = "doc-*"; // every Digital Publishing role (doc-cover, doc-subtitle, ...)
const TABLE_CELL = L("cell gridcell none presentation");

// -> { allowed: string[] | null, implicit: string|null } for an element; allowed null = any role
export function rolesFor(tag, a) {
  tag = String(tag).toLowerCase();
  if (tag.includes("-")) return { allowed: ANY, implicit: null }; // custom element
  switch (tag) {
    case "form": return { allowed: L("search none presentation"), implicit: "form" };
    case "a":
      return a.href !== undefined
        ? { allowed: L(`button checkbox menuitem menuitemcheckbox menuitemradio option radio switch tab treeitem ${DOC}`), implicit: "link" }
        : { allowed: ANY, implicit: null };
    case "button": return { allowed: L("checkbox combobox link menuitem menuitemcheckbox menuitemradio option radio switch tab"), implicit: "button" };
    case "img": {
      if (a.alt === undefined) return { allowed: ANY, implicit: null }; // no alt: no claim
      if (String(a.alt) === "") return { allowed: L("none presentation"), implicit: null };
      return { allowed: L("button checkbox link menuitem menuitemcheckbox menuitemradio option progressbar scrollbar separator slider switch tab treeitem meter doc-cover"), implicit: "img" };
    }
    case "input": {
      const type = String(a.type || "text").toLowerCase();
      if (type === "text") return { allowed: L("combobox searchbox spinbutton"), implicit: "textbox" };
      if (type === "checkbox") return { allowed: L("menuitemcheckbox option switch button"), implicit: "checkbox" };
      if (type === "radio") return { allowed: L("menuitemradio"), implicit: "radio" };
      if (type === "button" || type === "submit" || type === "reset") return { allowed: L("checkbox combobox link menuitem menuitemcheckbox menuitemradio option radio switch tab"), implicit: "button" };
      return { allowed: ANY, implicit: null };
    }
    case "select": return { allowed: L("menu combobox listbox"), implicit: "combobox" };
    case "textarea": return { allowed: L("none"), implicit: "textbox" };
    case "li": return { allowed: L("menuitem menuitemcheckbox menuitemradio option none presentation radio separator tab treeitem"), implicit: "listitem" };
    case "ul": case "ol": return { allowed: L("directory group listbox menu menubar none presentation radiogroup tablist toolbar tree"), implicit: "list" };
    case "nav": return { allowed: L("menu menubar none presentation tablist"), implicit: "navigation" };
    case "header": return { allowed: L("group none presentation"), implicit: "banner" };
    case "footer": return { allowed: L("group none presentation"), implicit: "contentinfo" };
    case "main": return { allowed: L("none"), implicit: "main" };
    case "section": return { allowed: L("alert alertdialog application banner complementary contentinfo dialog document feed log main marquee navigation none note presentation region search status tabpanel"), implicit: "region" };
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return { allowed: L("none presentation tab doc-subtitle"), implicit: "heading" };
    case "table": return { allowed: ANY, implicit: "table" };
    case "tr": return { allowed: L("row none presentation"), implicit: "row" };
    case "td": return { allowed: TABLE_CELL, implicit: "cell" };
    case "th": return { allowed: L("columnheader rowheader cell gridcell none presentation"), implicit: "columnheader" };
    case "p": case "div": case "span": return { allowed: ANY, implicit: null };
    case "label": return { allowed: L("none"), implicit: null };
    case "fieldset": return { allowed: L("group none presentation radiogroup"), implicit: "group" };
    case "summary": return { allowed: L("none"), implicit: null };
    case "details": return { allowed: L("none"), implicit: "group" };
    case "dialog": return { allowed: L("alertdialog"), implicit: "dialog" };
    case "iframe": return { allowed: L("application document img none presentation"), implicit: null };
    case "article": return { allowed: L("application document feed main none presentation region"), implicit: "article" };
    case "aside": return { allowed: L(`feed none note presentation region search ${DOC}`), implicit: "complementary" };
    case "hr": return { allowed: L("none presentation doc-pagebreak"), implicit: "separator" };
    default: return { allowed: ANY, implicit: null };
  }
}

// -> null when the role is allowed on this element, else { role, allowed } (allowed as the text to print)
export function checkRole(tag, attrs) {
  const raw = attrs.role;
  if (raw === undefined) return null;
  const role = String(raw).trim().toLowerCase().split(/\s+/)[0]; // the first role is the one that counts; the rest are fallbacks
  if (!role) return null;
  const { allowed, implicit } = rolesFor(tag, attrs);
  if (allowed === ANY) return null;
  if (role === implicit) return null;
  if (allowed.includes(role)) return null;
  if (allowed.includes(DOC) && role.startsWith("doc-")) return null;
  return { role, allowed: allowed.join(" ") + (implicit ? ` (and its own role, ${implicit})` : "") };
}

// ---- a small HTML tokenizer: start tags with their attributes (no DOM; the content of script/style/comments is skipped) ----
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
export function parseAttrs(s) {
  const out = {};
  for (const m of String(s || "").matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}
export function stripNonMarkup(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length))
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (m, a, b, c) => a + " ".repeat(b.length) + c)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (m, a, b, c) => a + " ".repeat(b.length) + c);
}
// -> [{ tag, attrs, raw, index }] for every start tag. Lengths are kept so `index` points into the original html.
export function startTags(html) {
  const clean = stripNonMarkup(html), out = [];
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
  for (const m of clean.matchAll(re)) out.push({ tag: m[1].toLowerCase(), attrs: parseAttrs(m[2]), raw: html.slice(m.index, m.index + m[0].length), index: m.index });
  return out;
}
// every role violation of one page -> [{ tag, role, allowed, snippet }]
export function roleViolations(html) {
  const bad = [];
  for (const t of startTags(html)) {
    if (t.attrs.role === undefined) continue;
    const v = checkRole(t.tag, t.attrs);
    if (v) bad.push({ tag: t.tag, role: v.role, allowed: v.allowed, snippet: t.raw.replace(/\s+/g, " ").slice(0, 140) });
  }
  return bad;
}
