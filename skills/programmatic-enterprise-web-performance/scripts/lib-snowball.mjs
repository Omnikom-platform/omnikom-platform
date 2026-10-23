// The Snowball English stemmer ("Porter2"), written from the published algorithm description
// (https://snowballstem.org/algorithms/english/stemmer.html). shipgate pins a Snowball stemmer per locale (web-delivery section 12,
// WP-104); this is the English one. No other language is built: stemFor() reports "no stemmer built" for them so a caller can
// say BLOCKED instead of comparing unstemmed words against a stemmed spec.
const VOWELS = new Set("aeiouy");
const isV = (w, i) => VOWELS.has(w[i]);
const DOUBLES = ["bb", "dd", "ff", "gg", "mm", "nn", "pp", "rr", "tt"];
const LI_END = new Set("cdeghkmnrt");
const EXC1 = { skis: "ski", skies: "sky", dying: "die", lying: "lie", tying: "tie", idly: "idl", gently: "gentl", ugly: "ugli", early: "earli", only: "onli", singly: "singl", sky: "sky", news: "news", howe: "howe", atlas: "atlas", cosmos: "cosmos", bias: "bias", andes: "andes" };
const EXC2 = new Set(["inning", "outing", "canning", "herring", "earring", "proceed", "exceed", "succeed"]);

function regions(w) {
  const after = (from) => { for (let i = from; i < w.length; i++) if (!isV(w, i) && i > 0 && isV(w, i - 1)) return i + 1; return w.length; };
  let r1;
  const pre = ["gener", "commun", "arsen"].find((p) => w.startsWith(p));
  r1 = pre ? pre.length : after(1);
  return [r1, (() => { for (let i = r1 + 1; i < w.length; i++) if (!isV(w, i) && isV(w, i - 1)) return i + 1; return w.length; })()];
}
const shortSyl = (w, end) => { // does w[0..end) end in a short syllable
  if (end === 2) return isV(w, 0) && !isV(w, 1);
  if (end < 3) return false;
  const a = w[end - 3], b = w[end - 2], c = w[end - 1];
  return !VOWELS.has(a) && VOWELS.has(b) && !VOWELS.has(c) && !"wxY".includes(c);
};
const longest = (w, list) => list.filter((s) => w.endsWith(s)).sort((a, b) => b.length - a.length)[0] || null;

export function stemEnglish(input) {
  let w = String(input).toLowerCase();
  if (w.length <= 2) return w;
  if (w in EXC1) return EXC1[w];
  if (w[0] === "'") w = w.slice(1);
  w = w.replace(/’/g, "'");
  if (w.length <= 2) return w;
  const arr = [...w];
  if (arr[0] === "y") arr[0] = "Y";
  for (let i = 1; i < arr.length; i++) if (arr[i] === "y" && VOWELS.has(arr[i - 1])) arr[i] = "Y";
  w = arr.join("");
  let [r1, r2] = regions(w);
  const inR1 = (suf) => w.length - suf.length >= r1, inR2 = (suf) => w.length - suf.length >= r2;
  const cut = (n, add = "") => { w = w.slice(0, w.length - n) + add; };
  // step 0
  { const s = longest(w, ["'s'", "'s", "'"]); if (s) cut(s.length); }
  // step 1a
  {
    const s = longest(w, ["sses", "ied", "ies", "ss", "us", "s"]);
    if (s === "sses") cut(2);
    else if (s === "ied" || s === "ies") cut(3, w.length - 3 > 1 ? "i" : "ie");
    else if (s === "s") { if ([...w.slice(0, -2)].some((_, i) => isV(w, i))) cut(1); }
  }
  if (EXC2.has(w)) return w.replace(/Y/g, "y");
  // step 1b
  {
    const s = longest(w, ["eedly", "eed", "ingly", "edly", "ing", "ed"]);
    if (s === "eed" || s === "eedly") { if (inR1(s)) cut(s.length, "ee"); }
    else if (s) {
      const stem = w.slice(0, w.length - s.length);
      if ([...stem].some((_, i) => isV(stem, i))) {
        w = stem;
        if (/(at|bl|iz)$/.test(w)) w += "e";
        else if (DOUBLES.some((d) => w.endsWith(d))) w = w.slice(0, -1);
        else if (r1 >= w.length && shortSyl(w, w.length)) w += "e";
      }
    }
  }
  // step 1c
  if (w.length > 2 && /[yY]$/.test(w) && !isV(w, w.length - 2)) cut(1, "i");
  // step 2
  {
    const MAP = { tional: "tion", enci: "ence", anci: "ance", abli: "able", entli: "ent", izer: "ize", ization: "ize", ational: "ate", ation: "ate", ator: "ate", alism: "al", aliti: "al", alli: "al", fulness: "ful", ousli: "ous", ousness: "ous", iveness: "ive", iviti: "ive", biliti: "ble", bli: "ble", fulli: "ful", lessli: "less" };
    const s = longest(w, [...Object.keys(MAP), "ogi", "li"]);
    if (s && inR1(s)) {
      if (s === "ogi") { if (w[w.length - 4] === "l") cut(3, "og"); }
      else if (s === "li") { if (LI_END.has(w[w.length - 3])) cut(2); }
      else cut(s.length, MAP[s]);
    }
  }
  // step 3
  {
    const MAP = { tional: "tion", ational: "ate", alize: "al", icate: "ic", iciti: "ic", ical: "ic", ful: "", ness: "" };
    const s = longest(w, [...Object.keys(MAP), "ative"]);
    if (s && inR1(s)) { if (s === "ative") { if (inR2(s)) cut(s.length); } else cut(s.length, MAP[s]); }
  }
  // step 4
  {
    const s = longest(w, ["al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement", "ment", "ent", "ism", "ate", "iti", "ous", "ive", "ize", "ion"]);
    if (s && inR2(s)) { if (s === "ion") { if (/[st]$/.test(w.slice(0, -3))) cut(3); } else cut(s.length); }
  }
  // step 5
  if (w.endsWith("e")) { if (inR2("e") || (inR1("e") && !shortSyl(w, w.length - 1))) cut(1); }
  else if (w.endsWith("l") && inR2("l") && w[w.length - 2] === "l") cut(1);
  return w.replace(/Y/g, "y");
}

// Languages that have a Snowball stemmer (snowballstem.org) and the one built here.
const SNOWBALL_LANGS = new Set(["ar", "ca", "da", "de", "el", "en", "es", "eu", "fi", "fr", "ga", "hi", "hu", "hy", "id", "it", "lt", "ne", "nl", "no", "nb", "nn", "pt", "ro", "ru", "sr", "sv", "ta", "tr", "yi"]);
const NO_STEM = new Set(["zh", "ja", "ko", "th"]);
// -> { stem(word), ok: true } | { ok: false, why }. A language without a Snowball stemmer compares after NFKC and case folding only (spec web-delivery 12).
export function stemFor(locale) {
  const lang = String(locale || "en").split(/[-_]/)[0].toLowerCase();
  if (lang === "en") return { ok: true, stem: stemEnglish, name: "snowball-english" };
  if (NO_STEM.has(lang) || !SNOWBALL_LANGS.has(lang)) return { ok: true, stem: (x) => x, name: "none" };
  return { ok: false, why: `the Snowball stemmer for "${lang}" is not built in this skill; shipgate pins one per locale` };
}
