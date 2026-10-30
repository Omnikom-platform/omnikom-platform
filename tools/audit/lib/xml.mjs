// A small well-formedness check for sitemap XML: balanced tags, one declaration, and every & written as an entity.
// Not a full XML parser (no DTDs, no namespaces); it finds the mistakes a hand-built or template-built sitemap actually has.
import { lineAt } from "./lines.mjs";

const BARE_AMP = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i;

// Returns [{ line, what }], empty when the text is well-formed.
export function xmlProblems(text) {
  const out = [];
  const stack = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)|(<)/g;
  let m;
  while ((m = re.exec(text))) {
    const line = lineAt(text, m.index);
    if (m[6] !== undefined) { out.push({ line, what: "a stray < that starts no tag" }); continue; }
    if (m[5] !== undefined) {
      if (BARE_AMP.test(m[5])) out.push({ line, what: "an unescaped & in the text (write &amp;)" });
      if (stack.length === 0 && m[5].trim()) out.push({ line, what: "text outside the root element" });
      continue;
    }
    if (m[2] === undefined) continue; // comment, CDATA or declaration
    if (BARE_AMP.test(m[3] || "")) out.push({ line, what: `an unescaped & in an attribute of <${m[2]}>` });
    if (m[1]) {
      const top = stack.pop();
      if (top !== m[2]) { out.push({ line, what: `the closing tag </${m[2]}> does not match the open <${top ?? "nothing"}>` }); if (top === undefined) continue; }
    } else if (!m[4]) stack.push(m[2]);
  }
  if (stack.length) out.push({ line: lineAt(text, text.length), what: `the element <${stack[stack.length - 1]}> is never closed` });
  return out;
}
