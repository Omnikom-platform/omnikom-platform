// MET-004 (W): title or description length outside its warnMin to warnMax range. A WARN, never a FAIL.
import { mk, codePoints } from "../lib/check.mjs";

export const id = "MET-004";
export const severity = "W";
export const source = "checklist/web-delivery.md MET-004";
const f = mk(id);

export function run(site) {
  const out = [];
  const t = site.config.titleLength, d = site.config.descriptionLength;
  for (const p of site.pageList) {
    const title = p.titles.find((x) => x.inHead && x.text);
    if (title) {
      const len = codePoints(title.text);
      if (len < t.warnMin || len > t.warnMax) out.push(f.warn(p.path, title.line, `the title is ${len} characters, the usual range is ${t.warnMin} to ${t.warnMax}`));
    }
    const desc = p.descriptions.find((x) => x.inHead && x.text);
    if (desc) {
      const len = codePoints(desc.text);
      if (len < d.warnMin || len > d.warnMax) out.push(f.warn(p.path, desc.line, `the meta description is ${len} characters, the usual range is ${d.warnMin} to ${d.warnMax}`));
    }
  }
  return out;
}
