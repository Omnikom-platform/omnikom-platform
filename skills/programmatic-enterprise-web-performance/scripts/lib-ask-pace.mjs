// The fixed pace of the asking script (owner, 2026-11-22, M250). Four things live here: the io object every wait goes through, the check of the
// pace block in work-browser-engines.json, how a text is cut into pieces, and how long a reply is read. Nothing here is chosen by chance and nothing
// reads a flag or an environment variable: the numbers are the file's, they are checked once before any page is loaded, and nothing changes them afterwards.
// The test replaces io.sleep by a recorder (it records the seconds asked for and returns at once); that is the only way a wait is ever shortened.

export const io = { sleep: (ms, _why) => new Promise((r) => setTimeout(r, ms)) };
export const pause = (seconds, why) => io.sleep(seconds * 1000, why);

// key: [lowest, highest]; null for the highest of readSecondsMax means "300", and its lowest is readSecondsMin's own value (checked below)
const RANGES = { tabsAtOnce: [1, 1], afterLoadSeconds: [3, 60], typeCharactersPerSecond: [1, 15], beforeSendSeconds: [1, 30], readSecondsPer100Words: [1, 60], readSecondsMin: [5, 120], readSecondsMax: [5, 300], betweenAssistantsSeconds: [60, 900] };
export const PACE_KEYS = Object.keys(RANGES);

export class PaceError extends Error { constructor(key, message) { super(message); this.key = key; } }

// the block as read from the file; returns a frozen copy, or throws a PaceError that names the key
export function checkPace(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) throw new PaceError("pace", "the engines file has no \"pace\" block (an object with the keys " + PACE_KEYS.join(", ") + ")");
  for (const k of Object.keys(block)) if (!Object.hasOwn(RANGES, k)) throw new PaceError(k, "the pace block has a key that is not known: " + k + " (known: " + PACE_KEYS.join(", ") + ")");
  for (const k of PACE_KEYS) {
    const v = block[k], [lo, hi] = RANGES[k];
    if (v === undefined) throw new PaceError(k, "the pace block has no " + k);
    if (typeof v !== "number" || !Number.isInteger(v)) throw new PaceError(k, "pace " + k + " is a whole number, not " + JSON.stringify(v));
    if (k === "tabsAtOnce") { if (v !== 1) throw new PaceError(k, "pace tabsAtOnce must be exactly 1, not " + v); continue; }
    if (v < lo || v > hi) throw new PaceError(k, "pace " + k + " is from " + lo + " to " + hi + ", not " + v);
  }
  if (block.readSecondsMax < block.readSecondsMin) throw new PaceError("readSecondsMax", "pace readSecondsMax (" + block.readSecondsMax + ") is under readSecondsMin (" + block.readSecondsMin + ")");
  return Object.freeze({ ...block });
}

// a text in pieces of at most n characters, in order (cut by whole characters, never inside a surrogate pair)
export function pieces(text, n) {
  const chars = Array.from(String(text)), out = [];
  for (let i = 0; i < chars.length; i += n) out.push(chars.slice(i, i + n).join(""));
  return out;
}

export const wordCount = (t) => (String(t).match(/\S+/g) || []).length;

// after the first reply: (words / 100) x readSecondsPer100Words, never under readSecondsMin, never over readSecondsMax
export function readingSeconds(words, pace) {
  const wanted = Math.round(words / 100 * pace.readSecondsPer100Words);
  return Math.min(pace.readSecondsMax, Math.max(pace.readSecondsMin, wanted));
}
