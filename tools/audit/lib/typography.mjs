// What an element declares about its type, from its classes (Tailwind), the stylesheets that reach it and its style attribute.
// Declared, not computed: no inheritance, no specificity, no media queries. Order of precedence used here: element and class rules of the
// stylesheets, then Tailwind classes (a class with a variant prefix such as md: or hover: is not read), then the style attribute; the
// last declaration of that order wins. Used by DSN-004, DSN-010 and DSN-011.
import { splitToken, lengthPx } from "./design.mjs";

const INLINE = "style attribute";
const baseUtilities = (sc, el) => sc.classes(el).map(splitToken).filter((t) => t.variants.length === 0).map((t) => ({ utility: t.utility, token: t.utility }));
const sheetDecls = (sc, el, props) => sc.css(el).filter((d) => props.includes(d.prop) && d.where !== INLINE);
const inlineDecls = (sc, el, props) => sc.css(el).filter((d) => props.includes(d.prop) && d.where === INLINE);
const lastOf = (list) => { const l = list.filter((c) => c.value !== null && c.value !== undefined); return l.length ? l[l.length - 1] : null; };

// ---- font size -> { px, desc } | null
const TW_SIZES = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128 };
export function declaredSize(sc, el) {
  const cand = [];
  for (const d of sheetDecls(sc, el, ["font-size"])) cand.push({ value: lengthPx(d.value), desc: `font-size: ${d.value} (${d.where})` });
  for (const { utility } of baseUtilities(sc, el)) {
    let m;
    if ((m = /^text-(xs|sm|base|lg|xl|[2-9]xl)$/.exec(utility))) cand.push({ value: TW_SIZES[m[1]], desc: `class "${utility}" (${TW_SIZES[m[1]]} px)` });
    else if ((m = /^text-\[(?:length:)?(.+)\]$/.exec(utility))) cand.push({ value: lengthPx(m[1]), desc: `class "${utility}"` });
  }
  for (const d of inlineDecls(sc, el, ["font-size"])) cand.push({ value: lengthPx(d.value), desc: `font-size: ${d.value} (${INLINE})` });
  const l = lastOf(cand);
  return l ? { px: l.value, desc: l.desc } : null;
}

// ---- font weight -> { weight, desc } | null
const TW_WEIGHTS = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
const cssWeight = (v) => { const s = String(v).trim().toLowerCase(); if (/^\d{3}$/.test(s)) return +s; if (s === "bold" || s === "bolder") return 700; if (s === "normal") return 400; if (s === "lighter") return 300; return null; };
export function declaredWeight(sc, el) {
  const cand = [];
  for (const d of sheetDecls(sc, el, ["font-weight"])) cand.push({ value: cssWeight(d.value), desc: `font-weight: ${d.value} (${d.where})` });
  for (const { utility } of baseUtilities(sc, el)) {
    let m;
    if ((m = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.exec(utility))) cand.push({ value: TW_WEIGHTS[m[1]], desc: `class "${utility}" (${TW_WEIGHTS[m[1]]})` });
    else if ((m = /^font-\[(\d{3})\]$/.exec(utility))) cand.push({ value: +m[1], desc: `class "${utility}"` });
  }
  for (const d of inlineDecls(sc, el, ["font-weight"])) cand.push({ value: cssWeight(d.value), desc: `font-weight: ${d.value} (${INLINE})` });
  const l = lastOf(cand);
  return l ? { weight: l.value, desc: l.desc } : null;
}

// ---- letter spacing -> { sign: -1 | 0 | 1, desc } | null
const spacingSign = (v) => { const s = String(v).trim().toLowerCase(); if (s === "normal") return 0; const m = /^(-?\d*\.?\d+)(px|em|rem|%|pt|ch|ex|vw)?$/.exec(s); if (!m) return null; const n = parseFloat(m[1]); return n > 0 ? 1 : n < 0 ? -1 : 0; };
const TW_TRACKING = { tighter: -1, tight: -1, normal: 0, wide: 1, wider: 1, widest: 1 };
export function declaredTracking(sc, el) {
  const cand = [];
  for (const d of sheetDecls(sc, el, ["letter-spacing"])) cand.push({ value: spacingSign(d.value), desc: `letter-spacing: ${d.value} (${d.where})` });
  for (const { utility } of baseUtilities(sc, el)) {
    let m;
    if ((m = /^tracking-(tighter|tight|normal|wide|wider|widest)$/.exec(utility))) cand.push({ value: TW_TRACKING[m[1]], desc: `class "${utility}"` });
    else if ((m = /^tracking-\[(.+)\]$/.exec(utility))) cand.push({ value: spacingSign(m[1]), desc: `class "${utility}"` });
  }
  for (const d of inlineDecls(sc, el, ["letter-spacing"])) cand.push({ value: spacingSign(d.value), desc: `letter-spacing: ${d.value} (${INLINE})` });
  const l = lastOf(cand);
  return l ? { sign: l.value, desc: l.desc } : null;
}

// ---- text transform -> { upper: boolean, desc } | null
export function declaredUppercase(sc, el) {
  const cand = [];
  for (const d of sheetDecls(sc, el, ["text-transform"])) cand.push({ value: /^uppercase$/i.test(d.value.trim()), desc: `text-transform: ${d.value} (${d.where})` });
  for (const { utility } of baseUtilities(sc, el)) {
    if (utility === "uppercase") cand.push({ value: true, desc: 'class "uppercase"' });
    else if (utility === "lowercase" || utility === "capitalize" || utility === "normal-case") cand.push({ value: false, desc: `class "${utility}"` });
  }
  for (const d of inlineDecls(sc, el, ["text-transform"])) cand.push({ value: /^uppercase$/i.test(d.value.trim()), desc: `text-transform: ${d.value} (${INLINE})` });
  const l = lastOf(cand);
  return l ? { upper: l.value, desc: l.desc } : null;
}

// "<span>" and a short quote of the element's text, for the finding line
export const shortText = (s, n = 40) => { const t = String(s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "..." : t; };
