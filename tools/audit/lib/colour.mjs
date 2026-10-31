// Colour reading for DSN-002 (hue gradients). Node built-ins only, nothing here judges a page: it turns a colour word, a colour
// function or a Tailwind colour name into a hue family, or says "no family" (greys, black, white, transparent) or "unknown" (a form this
// reader does not parse: oklch, oklab, lab, lch, color-mix, var(), a custom Tailwind colour name). The table below is the head's reading of
// DECISIONS 37 ("hue gradients as backgrounds"); it is printed in rules/DSN-002.md and a test keeps the two equal.

// Eight hue families, by hue angle in degrees (HSL), and the Tailwind colour names that belong to each.
export const HUE_FAMILIES = [
  { family: "red", from: 345, to: 15, tailwind: ["red", "rose"] },
  { family: "orange", from: 15, to: 45, tailwind: ["orange"] },
  { family: "yellow", from: 45, to: 75, tailwind: ["amber", "yellow"] },
  { family: "green", from: 75, to: 165, tailwind: ["lime", "green", "emerald"] },
  { family: "cyan", from: 165, to: 195, tailwind: ["teal", "cyan"] },
  { family: "blue", from: 195, to: 255, tailwind: ["sky", "blue", "indigo"] },
  { family: "purple", from: 255, to: 315, tailwind: ["violet", "purple", "fuchsia"] },
  { family: "pink", from: 315, to: 345, tailwind: ["pink"] },
];
// Tailwind colour names that are no family.
export const TW_NO_FAMILY = new Set(["slate", "gray", "zinc", "neutral", "stone", "black", "white", "transparent", "current", "inherit"]);
export const TW_FAMILY = Object.fromEntries(HUE_FAMILIES.flatMap((h) => h.tailwind.map((n) => [n, h.family])));
// A colour is grey (no family) when it is nearly colourless, nearly black or nearly white.
export const GREY_RULE = { maxSaturation: 0.10, maxLightness: 0.05, minLightness: 0.96 };

export function familyOfHue(h) {
  const x = ((h % 360) + 360) % 360;
  for (const f of HUE_FAMILIES) if (f.from < f.to ? x >= f.from && x < f.to : x >= f.from || x < f.to) return f.family;
  return null;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

// A small set of CSS colour names (hex), enough for hand-written gradients; a name not in the table is unknown.
const NAMED = {
  red: "#ff0000", orange: "#ffa500", yellow: "#ffff00", green: "#008000", lime: "#00ff00", blue: "#0000ff", cyan: "#00ffff", aqua: "#00ffff",
  teal: "#008080", navy: "#000080", purple: "#800080", magenta: "#ff00ff", fuchsia: "#ff00ff", pink: "#ffc0cb", violet: "#ee82ee", indigo: "#4b0082",
  gold: "#ffd700", crimson: "#dc143c", coral: "#ff7f50", tomato: "#ff6347", salmon: "#fa8072", maroon: "#800000", olive: "#808000",
  turquoise: "#40e0d0", skyblue: "#87ceeb", royalblue: "#4169e1", hotpink: "#ff69b4", deeppink: "#ff1493", orchid: "#da70d6", plum: "#dda0dd",
  lavender: "#e6e6fa", springgreen: "#00ff7f", dodgerblue: "#1e90ff", slateblue: "#6a5acd", rebeccapurple: "#663399",
  black: "#000000", white: "#ffffff", gray: "#808080", grey: "#808080", silver: "#c0c0c0", transparent: "transparent", currentcolor: "transparent",
};

// -> { rgb: [r,g,b] } | { none: true } (transparent) | null (not a colour this reader parses)
export function parseColour(input) {
  const s = String(input).trim().toLowerCase();
  let m;
  if ((m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s))) {
    let h = m[1];
    if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
    return { rgb: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] };
  }
  if ((m = /^rgba?\(([^)]*)\)$/.exec(s))) {
    const p = m[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
    if (p.length < 3) return null;
    const v = p.slice(0, 3).map((x) => (x.endsWith("%") ? (parseFloat(x) / 100) * 255 : parseFloat(x)));
    if (v.some((x) => !Number.isFinite(x))) return null;
    return { rgb: v.map((x) => Math.max(0, Math.min(255, x))) };
  }
  if ((m = /^hsla?\(([^)]*)\)$/.exec(s))) {
    const p = m[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
    if (p.length < 3) return null;
    const h = parseFloat(p[0]), sat = parseFloat(p[1]) / 100, l = parseFloat(p[2]) / 100;
    if (![h, sat, l].every(Number.isFinite)) return null;
    const a = sat * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return { rgb: [f(0) * 255, f(8) * 255, f(4) * 255] };
  }
  if (Object.prototype.hasOwnProperty.call(NAMED, s)) return NAMED[s] === "transparent" ? { none: true } : parseColour(NAMED[s]);
  return null;
}

// The hue family of a CSS colour: { family } | { none: true } | { unknown: true }
export function colourFamily(input) {
  const c = parseColour(input);
  if (!c) return { unknown: true };
  if (c.none) return { none: true };
  const { h, s, l } = rgbToHsl(...c.rgb);
  if (s < GREY_RULE.maxSaturation || l < GREY_RULE.maxLightness || l > GREY_RULE.minLightness) return { none: true };
  return { family: familyOfHue(h) };
}

// Every <kind>-gradient( ... ) in a CSS value, with balanced parentheses: [{ kind, args }]
export function gradientsIn(value) {
  const out = [];
  const re = /\b((?:repeating-)?(?:linear|radial|conic))-gradient\(/gi;
  let m;
  while ((m = re.exec(value))) {
    let depth = 1, i = re.lastIndex;
    for (; i < value.length && depth > 0; i++) { if (value[i] === "(") depth++; else if (value[i] === ")") depth--; }
    out.push({ kind: m[1].toLowerCase() + "-gradient", args: value.slice(re.lastIndex, depth === 0 ? i - 1 : i) });
    re.lastIndex = i;
  }
  return out;
}

// Top-level comma split (commas inside parentheses stay).
export function splitTop(s) {
  const out = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++; else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

// The hue families of the colour stops of one gradient's arguments, in order, each with the stop text: [{ stop, family }]
export function gradientStops(args) {
  const out = [];
  for (const part of splitTop(args)) {
    const m = /^(#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|(?:oklch|oklab|lab|lch|hwb|color-mix|color|var)\(.*\)|[a-z]+)/i.exec(part);
    if (!m) continue;
    const tok = m[1];
    if (/^(?:oklch|oklab|lab|lch|hwb|color-mix|color|var)\(/i.test(tok)) { out.push({ stop: tok, unknown: true }); continue; }
    if (/^[a-z]+$/i.test(tok) && !Object.prototype.hasOwnProperty.call(NAMED, tok.toLowerCase())) continue; // "to", "circle", "from", "in" ...
    const f = colourFamily(tok);
    out.push({ stop: tok, ...f });
  }
  return out;
}
