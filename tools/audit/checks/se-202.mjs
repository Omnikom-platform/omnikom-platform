// SE-202 (P1): Bing minimum lengths: title >= 20 and meta description >= 50 Unicode code points
// (pages whose <html lang> primary subtag is zh, ja or ko: title >= 10, description >= 25).
import { mk, codePoints } from "../lib/check.mjs";

export const id = "SE-202";
export const severity = "P1";
export const source = "checklist/search-engines.md SE-202";
const f = mk(id);

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    const primary = String(p.lang).split(/[-_]/)[0].toLowerCase();
    const cjk = primary === "zh" || primary === "ja" || primary === "ko";
    const minTitle = cjk ? 10 : 20, minDesc = cjk ? 25 : 50;
    const title = p.titles.find((x) => x.inHead && x.text);
    if (title) { const len = codePoints(title.text); if (len < minTitle) out.push(f.fail(p.path, title.line, `value-mismatch: the title is ${len} characters, Bing wants at least ${minTitle}`)); }
    const desc = p.descriptions.find((x) => x.inHead && x.text);
    if (desc) { const len = codePoints(desc.text); if (len < minDesc) out.push(f.fail(p.path, desc.line, `value-mismatch: the meta description is ${len} characters, Bing wants at least ${minDesc}`)); }
  }
  return out;
}
