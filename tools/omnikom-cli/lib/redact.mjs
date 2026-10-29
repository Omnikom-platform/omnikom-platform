// Rule 1 of the spec (26-PLATFORM-CLI section 5): the CLI never prints a secret. Every byte that leaves the program (stdout and
// stderr) goes through redact(). Two layers:
//   1. exact values: every environment variable whose NAME looks like a secret (KEY, SECRET, TOKEN, PASSWORD, DB_URL, ...) plus
//      anything registered at run time (a key minted a moment ago), in raw and in JSON-escaped form;
//   2. shapes: a JWT, an sb_secret_ / sb_publishable_ key, a 64-digit hex string (a signature or a key), a connection string,
//      a Bearer token. These catch a value the environment did not hold (a server that echoes a header back).
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|DB_URL|SIGNING|CREDENTIAL)/i;
const MIN_LEN = 8;
const runtime = new Map();   // value -> label

export const registerSecret = (value, label = 'secret') => { if (typeof value === 'string' && value.length >= MIN_LEN) runtime.set(value, label); };
export const clearRuntimeSecrets = () => runtime.clear();

function urlParts(value) {
  try {
    const u = new URL(value);
    return u.password ? [decodeURIComponent(u.password), u.password] : [];
  } catch { return []; }
}

export function knownSecrets(env = process.env) {
  const out = new Map(runtime);
  for (const [name, value] of Object.entries(env)) {
    if (!SECRET_NAME.test(name) || typeof value !== 'string' || value.length < MIN_LEN) continue;
    out.set(value, name);
    for (const p of urlParts(value)) if (p.length >= MIN_LEN) out.set(p, name);
  }
  return out;
}

const SHAPES = [
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '<jwt redacted>'],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, '<supabase key redacted>'],
  [/\b[0-9a-fA-F]{64}\b/g, '<hex64 redacted>'],
  [/\b(postgres(?:ql)?):\/\/[^\s"'<>]+/gi, '$1://<redacted>'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, 'Bearer <redacted>'],
];

export function redact(text, env = process.env) {
  let s = String(text);
  const secrets = [...knownSecrets(env)].sort((a, b) => b[0].length - a[0].length);
  for (const [value, label] of secrets) {
    const escaped = JSON.stringify(value).slice(1, -1);
    s = s.split(value).join(`<redacted:${label}>`);
    if (escaped !== value) s = s.split(escaped).join(`<redacted:${label}>`);
  }
  for (const [re, to] of SHAPES) s = s.replace(re, to);
  return s;
}

// What the program prints. One JSON object; compact on one line with --json, indented otherwise.
export const render = (obj, { compact = false, env = process.env } = {}) => redact(JSON.stringify(obj, null, compact ? 0 : 2), env) + '\n';
