// The _headers file of a built folder (Cloudflare Pages format), read for the X-Robots-Tag it sets on each built page (slice 4c).
// Format: a URL pattern at column 0, then indented lines under it, each "Name: value" or "! Name" (detach: drop that header, set by an
// earlier matching rule, for these URLs). "#" starts a comment line. Patterns: "*" is a splat (matches anything, "/" included; one per pattern),
// ":name" is a placeholder (one or more characters except "/"); every other character is literal. Rules apply in file order; every rule whose
// pattern matches the URL path contributes its header lines.
// A pattern that cannot be matched exactly is NOT judged: one that is not a path (a host pattern such as https://:project.pages.dev/*), and one
// with more than one splat. Such a pattern is listed in `skipped` and decides nothing. Matching is case-sensitive, against the path the page
// is served at: index.html is its folder with a trailing slash (about/index.html -> /about/), foo.html is /foo.
// Each contribution of an X-Robots-Tag line is read as its own header line (googleRobotsDirectives: no bot name or googlebot counts).
import { googleRobotsDirectives, robotsNoindex } from "./site.mjs";

export function parseHeadersFile(text) {
  const rules = [];
  let cur = null;
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim() || /^\s*#/.test(raw)) return;
    if (!/^\s/.test(raw)) { cur = { pattern: raw.trim(), line, headers: [] }; rules.push(cur); return; }
    if (!cur) return;
    const t = raw.trim();
    if (t.startsWith("!")) { const name = t.slice(1).split(":")[0].trim().toLowerCase(); if (name) cur.headers.push({ name, value: "", line, detach: true }); return; }
    const c = t.indexOf(":");
    if (c <= 0) return;
    cur.headers.push({ name: t.slice(0, c).trim().toLowerCase(), value: t.slice(c + 1).trim(), line, detach: false });
  });
  return rules;
}

// A RegExp for a pattern, or null when the pattern cannot be matched exactly.
export function compilePattern(pattern) {
  if (!pattern.startsWith("/")) return null;
  if ((pattern.match(/\*/g) || []).length > 1) return null;
  let re = "";
  for (let i = 0; i < pattern.length; ) {
    const ch = pattern[i];
    if (ch === "*") { re += ".*"; i++; continue; }
    const ph = ch === ":" ? /^:[A-Za-z][A-Za-z0-9_]*/.exec(pattern.slice(i)) : null;
    if (ph) { re += "[^/]+"; i += ph[0].length; continue; }
    re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); i++;
  }
  return new RegExp("^" + re + "$");
}

// The path a built file is served at (Cloudflare Pages: index.html is its folder, foo.html is /foo).
export function servedPath(file) {
  let p = "/" + String(file).replace(/\\/g, "/");
  if (/\/index\.html?$/i.test(p)) return p.replace(/index\.html?$/i, "");
  return p.replace(/\.html?$/i, "");
}

// What the _headers rules say about X-Robots-Tag for one served path:
// { lines: [{ value, pattern, line }] (the contributions left after detaches), directives[], noindex, source (first noindex line, or null) }
export function robotsHeaderFor(rules, compiled, path) {
  let lines = [];
  rules.forEach((rule, i) => {
    const re = compiled[i];
    if (!re || !re.test(path)) return;
    for (const h of rule.headers) {
      if (h.name !== "x-robots-tag") continue;
      if (h.detach) lines = []; else lines.push({ value: h.value, pattern: rule.pattern, line: h.line });
    }
  });
  const directives = [];
  let source = null;
  for (const l of lines) {
    const d = googleRobotsDirectives(l.value);
    directives.push(...d);
    if (!source && robotsNoindex(d)) source = `_headers line ${l.line} (pattern ${l.pattern}): X-Robots-Tag: ${l.value}`;
  }
  return { lines, directives, noindex: !!source, source };
}

// Every header a served path gets from the rules (work order 38, SEC-010 and SEC-075): { name (lower case): [{ value, where }] }, one entry per header line
// that is left after the detaches; `where` names the line and the pattern. A header set by two matching rules is two entries (Cloudflare joins them with a comma).
export function headersFor(rules, compiled, path) {
  const out = {};
  rules.forEach((rule, i) => {
    const re = compiled[i];
    if (!re || !re.test(path)) return;
    for (const h of rule.headers) {
      if (h.detach) { delete out[h.name]; continue; }
      (out[h.name] ||= []).push({ value: h.value, where: `_headers line ${h.line} (pattern ${rule.pattern})` });
    }
  });
  return out;
}

// Fill headerRobots, headerNoindex and headerSource on every page of a folder from its _headers file (a folder with none: nothing is set), and, for
// SEC-010 and SEC-075, headers (every header the file gives that page) and headersKnown (true only when the folder has a _headers file: the folder
// itself says nothing about the headers a host adds).
// Returns { present, rules, skipped: [patterns not judged], skippedAll: [every pattern that sets a header and cannot be matched exactly] }.
export function applyHeadersFile(site) {
  const out = { present: site.has("_headers"), rules: [], skipped: [], skippedAll: [] };
  if (!out.present) return out;
  out.rules = parseHeadersFile(site.read("_headers"));
  const compiled = out.rules.map((r) => compilePattern(r.pattern));
  out.rules.forEach((r, i) => {
    if (compiled[i]) return;
    if (r.headers.some((h) => h.name === "x-robots-tag")) out.skipped.push(r.pattern);
    if (r.headers.length) out.skippedAll.push(r.pattern);
  });
  for (const p of site.pages.values()) {
    const r = robotsHeaderFor(out.rules, compiled, servedPath(p.file));
    p.headerRobots = r.directives; p.headerNoindex = r.noindex; p.headerSource = r.source;
    p.headers = headersFor(out.rules, compiled, servedPath(p.file)); p.headersKnown = true;
  }
  return out;
}
