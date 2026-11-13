// The result of one flows.yml run, from Playwright's JSON report (1.64.1: stats counts each test's outcome; errors holds a setup error). The repository is
// public: it prints the counts and the first error's first line, redacted (patterns of a355cab:tools/test/flows-digest.mjs). Exit 0 = a test passed, none failed.
import { appendFileSync, readFileSync } from 'node:fs';
const REDACTIONS = [
  [/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/g, '[token]'],                                   // a JWT
  [/\bhttps?:\/\/[^\s'"`)<>\]]+/gi, '[url]'],                                          // any URL (staging host, preview port, function paths)
  [/\b[\w-]+\.supabase\.(?:co|in)\b/gi, '[host]'],                                      // a project host without a scheme
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '[email]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[uuid]'],
  [/\b(?:crm-screens|5\.3 flows|flows) [0-9a-z]{6,12}(?: [\w-]+)?/gi, '[lead]'],      // CRM_MARK / CRM_LAYOUT names: "<mark> <RUN> <name>"
  [/\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, '[phone]'],
  [/\b[A-Za-z0-9_]{32,}\b/g, '[secret]'],                                               // a long key-like string (no hyphen: a uuid has its own rule above)
  [/\b[a-z]{20}\b/g, '[id]'],                                                           // a Supabase project ref
  [/[A-Za-z]:\\[^\s'"`]+/g, '[path]'],                                                  // a Windows path with a user name in it
];
const redact = (text) => REDACTIONS.reduce((t, [re, to]) => t.replace(re, to), String(text));
const firstLine = (text) => String(text || '').replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).find((l) => l.trim()) || '';
// --sends-lead <list.json> <spec file> (flows.yml, before the browser starts, when SITE_SIGNING_KEY_TEST_DEMO_A is empty): exit 1 when a chosen test sits
// in a describe of the spec whose code runs `lead send ... --as site:` (that command signs with the site's key: tools/omnikom-cli/lib/identity.mjs).
if (process.argv[2] === '--sends-lead') {
  let list, src;
  try { list = JSON.parse(readFileSync(process.argv[3], 'utf8')); src = readFileSync(process.argv[4], 'utf8'); } catch { console.log('BLOCKED: no readable list of the chosen flows'); process.exit(1); }
  const sending = src.split(/^test\.describe\('/m).slice(1).filter((b) => b.includes("'--as', 'site:")).map((b) => b.slice(0, b.indexOf("', ")));
  const chosen = (suite) => (sending.includes(suite.title) && (suite.specs || []).length > 0) || (suite.suites || []).some(chosen);
  if ((list.suites || []).some(chosen)) { console.log("BLOCKED: the chosen flow sends a lead and SITE_SIGNING_KEY_TEST_DEMO_A has no repository secret (setting one is the owner's)"); process.exit(1); }
  console.log('flows list: no chosen flow sends a lead');
  process.exit(0);
}
let report;
try { report = JSON.parse(readFileSync(process.argv[2], 'utf8')); } catch { console.log('flows result: no readable report'); process.exit(1); }
const s = report.stats || {};
const errors = report.errors || [];
const specs = [];
const walk = (suite) => { for (const sp of suite.specs || []) specs.push(sp); for (const c of suite.suites || []) walk(c); };
for (const suite of report.suites || []) walk(suite);
const bad = specs.find((sp) => (sp.tests || []).some((t) => t.status === 'unexpected'));
const badError = bad ? bad.tests.flatMap((t) => t.results || []).flatMap((r) => r.errors || [])[0] : undefined;
const message = errors.length ? errors[0].message : badError ? `${bad.title}: ${firstLine(badError.message)}` : '';
const words = [[s.unexpected, 'failed'], [s.skipped, 'skipped'], [s.expected, 'passed']].filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`);
const lines = [`flows result: ${words.length ? words.join(', ') : '0 tests ran'}`];
if (message) lines.push(`flows first error: ${redact(firstLine(message)).slice(0, 200)}`);
const ok = s.expected >= 1 && s.unexpected === 0 && errors.length === 0;
for (const l of lines) console.log(l);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n\n')}\n`);
process.exit(ok ? 0 : 1);
