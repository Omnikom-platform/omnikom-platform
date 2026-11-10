// rules: the migration lock lint (book row E19). lintFiles reads migrations in file-name order and tracks which tables exist before
// each file: a table created in an EARLIER file is existing, a table created in the SAME file is new and exempt from the lock rules
// (nothing reads or writes it yet). A table the folder never created (a vendor table) counts as existing: the statement could not
// run otherwise. Postgres 16 behaviour behind each rule: README.md "Why each rule is what it is".
import { scan } from './scan.mjs';

export const RULES = {
  L1: { reason: 'an index build without CONCURRENTLY (or a UNIQUE / PRIMARY KEY / EXCLUDE constraint that builds one) holds a lock that blocks every write to the table until it ends',
    safe: 'CREATE [UNIQUE] INDEX CONCURRENTLY in a file of its own marked "-- no-transaction"; for a constraint, then ADD CONSTRAINT ... USING INDEX' },
  L2: { reason: 'ADD CONSTRAINT (foreign key or check) validates every existing row while holding a lock that blocks writes',
    safe: 'ADD CONSTRAINT ... NOT VALID, then ALTER TABLE ... VALIDATE CONSTRAINT in a later statement or file (it only blocks other schema changes)' },
  L3: { reason: 'SET NOT NULL scans the whole table while holding ACCESS EXCLUSIVE, so reads and writes both wait',
    safe: 'ADD CONSTRAINT c CHECK (col IS NOT NULL) NOT VALID, VALIDATE CONSTRAINT c, then SET NOT NULL (Postgres 12 and later skip the scan)' },
  L4: { reason: 'ALTER COLUMN ... TYPE rewrites the table and its indexes while holding ACCESS EXCLUSIVE',
    safe: 'expand-contract: add a new column, backfill in batches, switch the readers, drop the old column in a later migration' },
  L5: { reason: 'a volatile default (or a serial, identity or stored generated column) is computed per row, so ADD COLUMN rewrites the table under ACCESS EXCLUSIVE',
    safe: 'ADD COLUMN with no default or a constant (or a stable one such as now()), backfill in batches, then ALTER COLUMN ... SET DEFAULT' },
  L6: { reason: 'LOCK TABLE, VACUUM FULL, CLUSTER and REINDEX without CONCURRENTLY hold a lock that blocks reads and writes for as long as they run',
    safe: 'REINDEX ... CONCURRENTLY in a "-- no-transaction" file; run VACUUM FULL and CLUSTER by hand in a maintenance window, never in a migration' },
  L7: { reason: 'a file that touches an existing table waits for its lock with no limit, and every later query on the table queues behind that wait',
    safe: "SET lock_timeout = '5s'; (or SET LOCAL lock_timeout in a transaction) before the first statement that touches an existing table" },
  E1: { reason: 'DROP COLUMN, DROP TABLE and RENAME break the code that still reads the old name; they are the contract step of expand-contract',
    safe: 'a header line "-- contract: expanded in <earlier migration file name>" naming the file that added the replacement (a column RENAME is refused: add, backfill, switch, drop)' },
  C1: { reason: 'CREATE INDEX CONCURRENTLY, REINDEX CONCURRENTLY, DROP INDEX CONCURRENTLY and VACUUM cannot run inside a transaction, and the applier wraps every file in one',
    safe: 'put them in a file of their own whose header line is "-- no-transaction"; such a file holds nothing else that needs a transaction' },
};
export const RULE_IDS = Object.keys(RULES);
export const FILE_NAME = /^\d{8,}_[A-Za-z0-9_.-]+\.sql$/;

const ID = '(?:"[^"]+"|[a-z_][a-z0-9_$]*)';
const QID = `${ID}(?:\\.${ID})?`;
const qn = t => { const s = t.replace(/"/g, '').replace(/\s+/g, ''); return s.includes('.') ? s : `public.${s}`; };
const VOLATILE = /\b(?:[a-z_][a-z0-9_]*\.)?(?:gen_random_uuid|gen_random_bytes|gen_salt|uuid_generate_v[0-9a-z]*|uuidv[0-9]+|clock_timestamp|random|setseed|timeofday|nextval|txid_current|pg_current_xact_id)\s*\(/;
const CONSTRAINT_WORDS = new Set(['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like']);
export const NO_TRANSACTION = /^\s*no-transaction\s*$/;
const CONTRACT = /^\s*contract:\s*expanded in\s+(\S+)\s*$/i;

function splitTop(text) {
  const out = []; let depth = 0, from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++; else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) { out.push(text.slice(from, i).trim()); from = i + 1; }
  }
  out.push(text.slice(from).trim());
  return out.filter(Boolean);
}

// DO $$ ... $$ runs at migration time, so its statements are read; a plpgsql wrapper word in front of one is stripped
const WRAP = /^(?:declare\b.*?\bbegin\b|begin\b|(?:if|elsif)\b.*?\bthen\b|else\b|loop\b|for\b.*?\bloop\b|when\b.*?\bthen\b|exception\b)\s*/;
function expandDo(st, depth = 0) {
  if (!/^do\b/.test(st.norm) || !st.dollars.length || depth > 3) return [st];
  const out = [st];
  for (const d of st.dollars) {
    for (const inner of scan(d.body).statements) {
      let norm = inner.norm, m, skipped = 0;
      while ((m = WRAP.exec(norm))) { skipped += m[0].trim().split(' ').length; norm = norm.slice(m[0].length); }
      const line = d.line + (inner.tokLines[skipped] ?? inner.line) - 1;   // the line of the first word after the wrapper words
      if (/^execute\s+''/.test(norm)) {                  // execute 'literal': the literal is a statement
        const lit = /'((?:[^']|'')*)'/.exec(inner.raw);
        if (lit) { for (const x of scan(lit[1].replace(/''/g, "'")).statements) out.push(...expandDo({ ...x, line }, depth + 1)); continue; }
      }
      out.push(...expandDo({ ...inner, norm, line }, depth + 1));
    }
  }
  return out;
}

export function lintFiles(files) {
  const names = files.map(f => f.name).sort();
  const findings = [], errors = [], noTxFiles = [];
  let existing = new Set();
  const proven = new Map(), pend = new Map();
  const isProven = (t, c) => (proven.get(t) || new Set()).has(c);
  const prove = (t, c) => { if (!proven.has(t)) proven.set(t, new Set()); proven.get(t).add(c); };
  for (const f of [...files].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    let sc;
    try { sc = scan(f.text); } catch (e) { errors.push(`${f.name}: ${e.message}`); continue; }
    const items = sc.statements.flatMap(expandDo).map((st, ord) => ({ ...st, ord }));
    const noTxDirective = sc.header.some(h => NO_TRANSACTION.test(h.text));
    if (noTxDirective) noTxFiles.push(f.name);
    const contracts = sc.header.map(h => ({ h, m: CONTRACT.exec(h.text) })).filter(x => x.m || /^\s*contract\b/i.test(x.h.text));
    const contractOk = contracts.length > 0 && contracts.every(x => x.m && FILE_NAME.test(x.m[1]) && names.includes(x.m[1]) && x.m[1] < f.name);
    const newHere = new Set(), dropped = new Set();
    // one finding per (file, line, rule): a waiver names exactly that, so two hits of a rule in one statement are one finding with both details
    const flag = (rule, st, detail) => {
      const same = findings.find(x => x.file === f.name && x.line === st.line && x.rule === rule);
      if (same) { if (detail && !same.detail.split('; ').includes(detail)) same.detail = same.detail ? `${same.detail}; ${detail}` : detail; return; }
      findings.push({ file: f.name, line: st.line, rule, text: st.raw.replace(/\s+/g, ' ').trim().slice(0, 90), detail: detail || '' });
    };
    let firstTouch = null, lockOrd = null;
    const touch = st => { if (!firstTouch) firstTouch = st; };
    const noTxStmts = [], otherStmts = [], contractSteps = [];
    for (const st of items) {
      const n = st.norm;
      let m;
      // ---- session settings: lock_timeout (counts only if it is not 0 / default; SET LOCAL does nothing outside a transaction)
      if ((m = /^set\s+(session\s+|local\s+)?lock_timeout\b/.exec(n))) {
        const v = /set\s+(?:session\s+|local\s+)?lock_timeout\s*(?:=|to)\s*'?([^'\s;]+)/i.exec(st.raw);
        const on = v && !/^(0+(\.0+)?(ms|s|min|h|d)?|default)$/i.test(v[1]);
        if (on && !(noTxDirective && m[1] && m[1].trim() === 'local') && lockOrd === null) lockOrd = st.ord;
        continue;
      }
      if (/^select\s+set_config\s*\(\s*''/.test(n)) {
        const v = /^select\s+set_config\s*\(\s*'lock_timeout'\s*,\s*'([^']*)'/i.exec(st.raw);
        if (v && !/^(0+(\.0+)?(ms|s|min|h|d)?)?$/i.test(v[1]) && lockOrd === null) lockOrd = st.ord;
        otherStmts.push(st); continue;
      }
      if (/^(set|reset)\b/.test(n)) continue;
      // ---- CREATE TABLE / MATERIALIZED VIEW
      if ((m = new RegExp(`^create\\s+(?:(?:global\\s+|local\\s+)?(?:temp|temporary)\\s+|unlogged\\s+)?(?:table|materialized\\s+view)\\s+(?:if\\s+not\\s+exists\\s+)?(${QID})`).exec(n))) {
        const t = qn(m[1]);
        newHere.add(t); dropped.delete(t);
        if (/^create\s+(?:global\s+|local\s+)?(?:temp|temporary)\b/.test(n)) newHere.add(`temp:${t}`);
        otherStmts.push(st); continue;
      }
      // ---- CREATE INDEX
      if ((m = new RegExp(`^create\\s+(unique\\s+)?index\\s+(concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?(?:${ID}\\s+)?on\\s+(?:only\\s+)?(${QID})`).exec(n))) {
        const t = qn(m[3]);
        if (m[2]) {
          noTxStmts.push(st);
          if (/\bif\s+not\s+exists\b/.test(n.slice(0, n.indexOf(' on ')))) flag('C1', st, 'IF NOT EXISTS: a failed build leaves an INVALID index of that name, and the retry would skip it and record the file as applied; drop the index first or name it without IF NOT EXISTS');
          if (!newHere.has(t)) touch(st);
        } else if (!newHere.has(t)) { flag('L1', st); touch(st); }
        continue;
      }
      if ((m = /^drop\s+index\s+(concurrently\s+)?/.exec(n))) { if (m[1]) noTxStmts.push(st); else otherStmts.push(st); touch(st); continue; }
      // ---- DROP TABLE
      if ((m = /^drop\s+(?:table|materialized\s+view)\s+(?:if\s+exists\s+)?(.+?)(?:\s+(?:cascade|restrict))?$/.exec(n))) {
        const ifExists = /^drop\s+(?:table|materialized\s+view)\s+if\s+exists\b/.test(n);
        for (const part of m[1].split(',')) {
          const t = qn(part.trim());
          if (newHere.has(t)) { newHere.delete(t); continue; }
          if (ifExists && !existing.has(t)) continue;   // IF EXISTS on a table no earlier migration made: nothing to drop
          dropped.add(t); touch(st); contractSteps.push({ st, kind: 'DROP TABLE' });
        }
        otherStmts.push(st); continue;
      }
      // ---- ALTER TABLE
      if ((m = new RegExp(`^alter\\s+(?:table|materialized\\s+view)\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QID})\\s*\\*?\\s+(.*)$`).exec(n))) {
        const t = qn(m[1]);
        otherStmts.push(st);
        if (newHere.has(t)) continue;
        touch(st);
        for (const a of splitTop(m[2])) {
          let x;
          if (/^rename\b/.test(a)) {
            if (/^rename\s+to\b/.test(a)) contractSteps.push({ st, kind: 'RENAME TABLE' });
            else if (!/^rename\s+constraint\b/.test(a)) contractSteps.push({ st, kind: 'RENAME COLUMN', refused: true });
          } else if ((x = new RegExp(`^add\\s+(column\\s+)?(?:if\\s+not\\s+exists\\s+)?(${ID})\\b(.*)$`).exec(a)) && (x[1] || !CONSTRAINT_WORDS.has(x[2]))) {
            const dflt = /\bdefault\b(.*)$/.exec(a);
            const why = /^(?:small|big)?serial\b/.test(x[3].trim()) ? 'serial type (nextval())'
              : /\bgenerated\s+(?:always|by\s+default)\s+as\s+identity\b/.test(a) ? 'identity column'
              : /\bgenerated\s+always\s+as\s*\(.*\)\s*stored\b/.test(a) ? 'stored generated column'
              : dflt && VOLATILE.test(dflt[1]) ? `volatile default ${VOLATILE.exec(dflt[1])[0].replace(/\s*\($/, '()')}` : '';
            if (why) flag('L5', st, why);
            // an inline CHECK on the new column scans the whole table, like ADD CONSTRAINT CHECK (measured, test/pg-facts.mjs). An inline REFERENCES
            // does not scan it (measured: the new column is all NULL), so it is not flagged.
            if (/\bcheck\s*\(/.test(a)) flag('L2', st, `inline CHECK on column ${x[2].replace(/"/g, '')}`);
          } else if ((x = new RegExp(`^add\\s+(?:constraint\\s+(${ID})\\s+)?(check|foreign\\s+key|unique|primary\\s+key|exclude)\\b(.*)$`).exec(a))) {
            const kind = x[2].replace(/\s+/g, ' '), notValid = /\bnot\s+valid\b/.test(a);
            if (kind === 'check' || kind === 'foreign key') {
              const nn = kind === 'check' && new RegExp(`\\bcheck\\s*\\(\\s*\\(?\\s*(${ID})\\s+is\\s+not\\s+null\\s*\\)?\\s*\\)`).exec(a);
              if (!notValid) flag('L2', st, kind);
              if (nn) { const col = nn[1].replace(/"/g, ''); if (notValid) { if (x[1]) pend.set(`${t}|${x[1].replace(/"/g, '')}`, col); } else prove(t, col); }
            } else if (!/\busing\s+index\b/.test(a)) flag('L1', st, `ADD CONSTRAINT ${kind.toUpperCase()} builds its index under ACCESS EXCLUSIVE`);
          } else if ((x = new RegExp(`^validate\\s+constraint\\s+(${ID})`).exec(a))) {
            const col = pend.get(`${t}|${x[1].replace(/"/g, '')}`);
            if (col) prove(t, col);
          } else if ((x = new RegExp(`^alter\\s+(?:column\\s+)?(${ID})\\s+(?:set\\s+data\\s+)?type\\b`).exec(a))) {
            flag('L4', st);
          } else if ((x = new RegExp(`^alter\\s+(?:column\\s+)?(${ID})\\s+set\\s+not\\s+null\\b`).exec(a))) {
            if (!isProven(t, x[1].replace(/"/g, ''))) flag('L3', st, `column ${x[1].replace(/"/g, '')}`);
          } else if (/^drop\s+(?!constraint\b)/.test(a)) {
            contractSteps.push({ st, kind: 'DROP COLUMN' });
          }
        }
        continue;
      }
      // ---- the rest of the lock statements
      if ((m = new RegExp(`^lock\\s+(?:table\\s+)?(?:only\\s+)?(${QID})`).exec(n))) { otherStmts.push(st); if (!newHere.has(qn(m[1]))) { flag('L6', st, 'LOCK TABLE'); touch(st); } continue; }
      if (/^vacuum\b/.test(n)) {
        noTxStmts.push(st);
        if (/\bfull\b/.test(n)) { flag('L6', st, 'VACUUM FULL'); touch(st); }
        continue;
      }
      if (/^cluster\b/.test(n)) {
        const target = new RegExp(`^cluster\\s+(?:verbose\\s+)?(${QID})`).exec(n);
        otherStmts.push(st);
        if (!(target && newHere.has(qn(target[1])))) { flag('L6', st, 'CLUSTER'); touch(st); }
        continue;
      }
      if (/^reindex\b/.test(n)) {
        if (/\bconcurrently\b/.test(n)) noTxStmts.push(st); else { otherStmts.push(st); flag('L6', st, 'REINDEX'); }
        touch(st); continue;
      }
      if ((m = new RegExp(`^truncate\\s+(?:table\\s+)?(?:only\\s+)?(${QID})`).exec(n))) { otherStmts.push(st); if (!newHere.has(qn(m[1]))) touch(st); continue; }
      if ((m = new RegExp(`^(?:create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+.*?\\bon|drop\\s+trigger\\s+(?:if\\s+exists\\s+)?${ID}\\s+on)\\s+(${QID})`).exec(n))) { otherStmts.push(st); if (!newHere.has(qn(m[1]))) touch(st); continue; }
      // CREATE / ALTER / DROP POLICY hold ACCESS EXCLUSIVE on the table (measured, test/pg-facts.mjs), so they touch it
      if ((m = new RegExp(`^(?:create|alter|drop)\\s+policy\\s+(?:if\\s+exists\\s+)?${ID}\\s+on\\s+(${QID})`).exec(n))) { otherStmts.push(st); if (!newHere.has(qn(m[1]))) touch(st); continue; }
      if (/^alter\s+system\b|^create\s+database\b|^drop\s+database\b|^create\s+tablespace\b/.test(n)) { noTxStmts.push(st); continue; }
      otherStmts.push(st);
    }
    // ---- L7
    if (firstTouch && !(lockOrd !== null && lockOrd < firstTouch.ord)) flag('L7', firstTouch);
    // ---- E1
    for (const s of contractSteps) if (s.refused || !contractOk) flag('E1', s.st, s.refused ? `${s.kind} is refused outright` : contracts.length ? `${s.kind}; the contract header does not name an earlier file of this folder` : `${s.kind}; no contract header`);
    // ---- C1
    if (noTxStmts.length && !noTxDirective) flag('C1', noTxStmts[0], 'no "-- no-transaction" header');
    if (noTxDirective) for (const s of otherStmts) flag('C1', s, 'a "-- no-transaction" file holds only the statements that cannot run in a transaction (and SET)');
    existing = new Set([...existing].filter(t => !dropped.has(t)));
    for (const t of newHere) if (!t.startsWith('temp:') && !newHere.has(`temp:${t}`)) existing.add(t);
  }
  return { findings: findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.rule < b.rule ? -1 : 1))), errors, noTxFiles, existing: [...existing].sort() };
}
