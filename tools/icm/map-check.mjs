// Map check (rule 36 in docs/product/11-rules.md): the four tables under work/map/ are checked the same way as the book. Called from
// check() in index.mjs, so CI's `node tools/icm/index.mjs --check` runs it. Node 20, no dependencies, no network, reads only.
// One plain line per problem, each starting with its label:
//   PARTS     work/map/parts.tsv     the parts of the platform still to build or prove
//   CLUSTERS  work/map/clusters.tsv  the groups they are built in
//   OWNER     work/map/owner.tsv     what only the owner can do
//   PROGRESS  work/map/progress.tsv  one line per landing
// A tree with no work/map folder has nothing to check. A table another table points into is only compared when that table was read.
// readMap(root) gives the parsed rows (cells as written) to progress.mjs and map-page.mjs.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readTsv } from './truth-check.mjs';
import { parseProduct } from './book-check.mjs';

const DIR = 'work/map';
const PRODUCT = 'docs/product/1-product.md';
const TABLES = {
  parts: { file: `${DIR}/parts.tsv`, label: 'PARTS', header: ['id', 'part', 'what', 'verdict', 'owner', 'cluster', 'rows'] },
  clusters: { file: `${DIR}/clusters.tsv`, label: 'CLUSTERS', header: ['n', 'cluster', 'closes', 'needs', 'size'] },
  owner: { file: `${DIR}/owner.tsv`, label: 'OWNER', header: ['n', 'kind', 'he does', 'then the head', 'opens', 'state', 'answer'] },
  progress: { file: `${DIR}/progress.tsv`, label: 'PROGRESS', header: ['date', 'commit', 'works', 'partly', 'built', 'total'] },
};
export const VERDICTS = ['BUILT', 'BUILT-UNPROVEN', 'HALF', 'NOT BUILT', 'CANNOT TELL'];
const SIZES = ['small', 'medium', 'large', 'largest'];
const KINDS = ['sitting', 'words', 'decision', 'go'];
const STATES = ['open', 'answered'];
const ID_RE = /^[A-Z]{2}\.[A-Za-z0-9-]+$/;
const NUMS_RE = /^(0|[1-9][0-9]*)( (0|[1-9][0-9]*))*$/;
const ROWS_RE = /^[A-Z]\d+( [A-Z]\d+)*$/;
export const COMMIT_RE = /^[0-9a-f]{8,40}$/;
const WHOLE = /^(0|[1-9][0-9]*)$/;
// one commit at any length: the short and the long form of a commit are the same commit
export const sameCommit = (a, b) => COMMIT_RE.test(a) && COMMIT_RE.test(b) && (a.startsWith(b) || b.startsWith(a));
const BOOK_ROW = /\b[A-E][0-9]+\b/g;

export const split = s => (s === '' ? [] : s.split(' '));
export function isDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return !!m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) === s;
}

function load(root, key) {
  const { file, label, header } = TABLES[key];
  const p = join(root, file);
  if (!existsSync(p)) return { rows: [], problems: [`${label}: ${file} is missing`], ok: false };
  if (!statSync(p).isFile()) return { rows: [], problems: [`${label}: ${file} is not a file`], ok: false };
  const t = readTsv(readFileSync(p, 'utf8'), header, label, file);
  const rows = t.rows.map(r => ({ ...Object.fromEntries(header.map((h, i) => [h.replace(/ (.)/g, (_, c) => c.toUpperCase()), r.cells[i]])), n: r.n, cells: r.cells }));
  return { rows, problems: [...t.problems] };
}

function numbered(rows, label, out) {
  for (const { n, cells: [c] } of rows) {
    if (!WHOLE.test(c)) out.push(`${label} line ${n}: the number "${c}" is not a whole number`);
    else if (Number(c) !== n - 1) out.push(`${label} line ${n}: the number is ${c}, expected ${n - 1}`);
  }
}
// a table that has any problem line of its own is not a reference: nothing is compared against it
const oneToN = t => (t.problems.length === 0 ? new Set(t.rows.map((_, i) => i + 1)) : null);

function ownerRefs(value, what, ownerSet, out, at) {
  if (!NUMS_RE.test(value)) { out.push(`${at}: the ${what} column holds "${value}", not owner item numbers`); return; }
  const named = new Set();
  for (const o of value.split(' ')) {
    if (named.has(o)) out.push(`${at}: the owner item ${o} is named twice`);
    else if (ownerSet && !ownerSet.has(Number(o))) out.push(`${at}: the owner item ${o} is not in ${TABLES.owner.file}`);
    named.add(o);
  }
}

// every row id written in a free cell (closes, opens) must be a row of the book
function bookRefs(value, bookRows, out, at) {
  if (!bookRows) return;
  for (const r of new Set(value.match(BOOK_ROW) || [])) if (!bookRows.has(r)) out.push(`${at}: the row ${r} is not in ${PRODUCT}`);
}

export function readMap(root) {
  if (existsSync(join(root, DIR)) && !statSync(join(root, DIR)).isDirectory()) return { parts: [], clusters: [], owner: [], progress: [], problems: [`PARTS: ${DIR} is not a folder`] };
  const t = { parts: load(root, 'parts'), clusters: load(root, 'clusters'), owner: load(root, 'owner'), progress: load(root, 'progress') };
  const out = { PARTS: t.parts.problems, CLUSTERS: t.clusters.problems, OWNER: t.owner.problems, PROGRESS: t.progress.problems };
  const hasBook = existsSync(join(root, PRODUCT)) && statSync(join(root, PRODUCT)).isFile();
  const bookRows = hasBook ? new Set([...parseProduct(readFileSync(join(root, PRODUCT), 'utf8')).parts.values()].flatMap(p => p.rows.map(r => r.id))) : null;
  let ownerSet = null, clusterSet = null;

  const checkParts = () => { // runs after the owner list and the clusters: only a table without a problem line of its own is a reference
  const seen = new Map();
  for (const { n, id, part, what, verdict, owner, cluster, rows } of t.parts.rows) {
    const at = `PARTS line ${n}`;
    if (!ID_RE.test(id)) out.PARTS.push(`${at}: the id ${id} is not two capital letters, a dot, then letters, digits or hyphens`);
    else if (seen.has(id)) out.PARTS.push(`${at}: the id ${id} is already on line ${seen.get(id)}`);
    if (!seen.has(id)) seen.set(id, n);
    if (part.trim() === '') out.PARTS.push(`${at}: the part is empty`);
    if (what.trim() === '') out.PARTS.push(`${at}: the what is empty`);
    if (!VERDICTS.includes(verdict)) out.PARTS.push(`${at}: the verdict "${verdict}" is not ${VERDICTS.slice(0, -1).join(', ')} or ${VERDICTS[VERDICTS.length - 1]}`);
    if (owner !== '') ownerRefs(owner, 'owner', ownerSet, out.PARTS, at);
    if (cluster !== '') {
      if (!WHOLE.test(cluster)) out.PARTS.push(`${at}: the cluster column holds "${cluster}", not one cluster number`);
      else if (clusterSet && !clusterSet.has(Number(cluster))) out.PARTS.push(`${at}: the cluster ${cluster} is not in ${TABLES.clusters.file}`);
    }
    if (rows !== '') {
      if (!ROWS_RE.test(rows)) out.PARTS.push(`${at}: the rows column holds "${rows}", not book row ids`);
      else {
        const named = new Set();
        for (const r of rows.split(' ')) {
          if (named.has(r)) out.PARTS.push(`${at}: the row ${r} is named twice`);
          else if (bookRows && !bookRows.has(r)) out.PARTS.push(`${at}: the row ${r} is not in ${PRODUCT}`);
          named.add(r);
        }
      }
    }
  }
  };

  numbered(t.owner.rows, 'OWNER', out.OWNER);
  for (const { n, kind, heDoes, opens, state, answer } of t.owner.rows) {
    const at = `OWNER line ${n}`;
    if (!KINDS.includes(kind)) out.OWNER.push(`${at}: the kind "${kind}" is not sitting, words, decision or go`);
    if (heDoes.trim() === '') out.OWNER.push(`${at}: the he does is empty`);
    bookRefs(opens, bookRows, out.OWNER, at);
    if (!STATES.includes(state)) out.OWNER.push(`${at}: the state "${state}" is not open or answered`);
    else if (state === 'answered' && answer === '') out.OWNER.push(`${at}: an answered item has no answer`);
    else if (state === 'open' && answer !== '') out.OWNER.push(`${at}: an open item has an answer`);
  }
  ownerSet = oneToN(t.owner);

  numbered(t.clusters.rows, 'CLUSTERS', out.CLUSTERS);
  for (const { n, cluster, closes, needs, size } of t.clusters.rows) {
    const at = `CLUSTERS line ${n}`;
    if (cluster.trim() === '') out.CLUSTERS.push(`${at}: the cluster is empty`);
    if (closes.trim() === '') out.CLUSTERS.push(`${at}: the closes is empty`);
    bookRefs(closes, bookRows, out.CLUSTERS, at);
    if (needs !== '') ownerRefs(needs, 'needs', ownerSet, out.CLUSTERS, at);
    if (!SIZES.includes(size)) out.CLUSTERS.push(`${at}: the size "${size}" is not small, medium, large or largest`);
  }
  clusterSet = oneToN(t.clusters);

  checkParts();

  let above = null;
  const seenCommits = [];
  for (const { n, date, commit, works, partly, built, total } of t.progress.rows) {
    const at = `PROGRESS line ${n}`;
    if (!isDate(date)) out.PROGRESS.push(`${at}: the date "${date}" is not a calendar date YYYY-MM-DD`);
    if (!COMMIT_RE.test(commit)) out.PROGRESS.push(`${at}: the commit "${commit}" is not 8 to 40 lowercase hex characters`);
    for (const [name, v] of [['works', works], ['partly', partly], ['built', built], ['total', total]]) if (!WHOLE.test(v)) out.PROGRESS.push(`${at}: the ${name} "${v}" is not a whole number`);
    if (WHOLE.test(built) && WHOLE.test(total) && Number(built) > Number(total)) out.PROGRESS.push(`${at}: built is above total`);
    if (above && isDate(date) && date < above) out.PROGRESS.push(`${at}: the date ${date} is before the line above (${above})`);
    const same = seenCommits.find(c => sameCommit(c.commit, commit));
    if (same) out.PROGRESS.push(`${at}: the commit ${commit} is already on line ${same.n}`);
    else seenCommits.push({ commit, n });
    above = isDate(date) ? date : null;
  }

  const problems = [...out.PARTS, ...out.CLUSTERS, ...out.OWNER, ...out.PROGRESS];
  return { parts: t.parts.rows, clusters: t.clusters.rows, owner: t.owner.rows, progress: t.progress.rows, problems };
}

export function checkMap(root) {
  const p = join(root, DIR);
  if (!existsSync(p)) return [];
  return readMap(root).problems;
}
