// Turns ONE saved Google Maps page text into ONE grid capture file (the maps-viewport form that local-grid.mjs imports).
// The text is the page as a helper saved it, one text per page: line 1 is the helper's header, line 2 the "VIEWPORT:" line, then the page's lines.
//   --raw <file>   a results list (the first 20 rows, in list order)
//   --card <file>  one place's card (a page that shows one business, not a list): one row, read from that place's own block only
// Usage: node grid-text-to-capture.mjs --pewp <run .pewp> (--raw <one list text> | --card <one card text>) --convert <dir> --captured-in "<text>"
// ourPosition is the position of the row whose name is the business's name in business.json (letter case aside), or null; local-grid.mjs finds the business by its own wider rule (name, aliases, domain, phone) and does not read this key.
// The request is the one in <pewp>/captures/local/grid/requests.json whose id is the header's id; the capture is written to
// <pewp>/captures/local/grid/<its captureFile>.
// REFUSED (exit 1, nothing written or moved, one line "REFUSED: <why>") when, for both: --captured-in is missing or empty; the file is not
// a file; the id is not in the requests; the request has no plain .json captureFile or no numeric point; there is no VIEWPORT line, or
// two different ones, or one that is not "<lat>,<lng>,<whole zoom>z"; the viewport is more than 0.0003 from the request's point;
// business.json has no name; the capture file of the id already holds "method" (already captured); originals/grid/<name> exists already.
// For --raw also: line 1 is not a header with an id; the page's "Group: Results for <x>" line is missing or <x> is not the request's query;
// the text holds a robot-check sign (unusual traffic, not a robot, recaptcha, before you continue); the header has no readAtUtc or lacks the
// two human-idle numbers.
// For --card also: the text holds a "Group: Results for" line (it is a list); the lines below the header hold a robot-check sign (line 1 is the
// helper's own words and is never judged as page text); the text does not hold exactly ONE place group (a Group with a Text of its own name and
// a "Group: Information for" it); the header lacks i, id, vp or readAtUtc; readAtUtc is not an ISO time; the header vp and the VIEWPORT line
// are not the same three numbers; a header line of the place holds a rating in a form this reader has not met.
// An existing capture file of the id WITHOUT "method" is first moved to <convert>/originals/grid/<same name> (a rename, sha256, size and write
// time checked before and after), then the new file is written (never over an existing file).
// The viewport is the numbers of the text's own VIEWPORT line, never the request's, a file name's or a guess.
// Exit: 0 done; 1 refused or a check failed; 2 usage; 4 an unexpected error.
// Last line: <id> rows=<n> ours=<position or -> sponsored=<n> viewport=<lat>,<lng>,<zoom> -> <file>   (a card: "... viewport=<..> card -> <file>")
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const argv = process.argv.slice(2);
const get = (k) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const PEWP = get("--pewp"), RAW = get("--raw"), CARD = get("--card"), CONVERT = get("--convert"), CAPTURED_IN = get("--captured-in");
const TOL = 0.0003;

class Refused extends Error {}
const refuse = (cond, why) => { if (!cond) throw new Refused(why); };
const J = (p) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8").trimStart()); }   // trimStart also drops a leading byte order mark (U+FEFF)
  catch (e) { throw new Refused(`${p}: not readable as JSON (${e.message})`); }
};
const shaOf = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const facts = (p) => { const s = fs.statSync(p); return { sha256: shaOf(fs.readFileSync(p)), size: s.size, mtimeMs: s.mtimeMs, mtime: s.mtime.toISOString() }; };

// "# i=19 id=<id> query=<q> point=r1c1 lat=.. lng=.. readAtUtc=.. [idleMsBeforePage=.. sinceOwnInputMsBeforePage=..] title=<rest of the line>"
// The first occurrence of a key wins and nothing after "title=" is read as a key (a page title may hold any text).
const HEAD_KEYS = ["i", "id", "query", "point", "lat", "lng", "readAtUtc", "idleMsBeforePage", "sinceOwnInputMsBeforePage", "title"];
function parseHeader(line) {
  const s = String(line ?? "").replace(/^\uFEFF/, "");
  if (!/^#\s/.test(s)) return null;
  const hits = [...s.matchAll(new RegExp(`(?:^|\\s)(${HEAD_KEYS.join("|")})=`, "g"))];
  const head = {};
  for (let k = 0; k < hits.length; k++) {
    const key = hits[k][1], from = hits[k].index + hits[k][0].length;
    if (key === "title") { if (!("title" in head)) head.title = s.slice(from); break; }
    const to = k + 1 < hits.length ? hits[k + 1].index : s.length;
    if (!(key in head)) head[key] = s.slice(from, to).trim();
  }
  return head;
}

function parseRows(lines) {
  const rows = []; let cur = null;
  for (const raw of lines) {
    const l = raw.trim();
    const h = l.match(/^Hyperlink: (.+)$/);
    if (h && !/^Visit .*website$/.test(h[1]) && !/^Get directions/.test(h[1])) { cur = { position: rows.length + 1, name: h[1], rating: null, reviews: null, category: null, address: null, phone: null, website: null, sponsored: /^(ad|sponsored) · /i.test(h[1]), _raw: [] }; rows.push(cur); continue; }
    if (!cur) continue;
    cur._raw.push(l);
    let m;
    if ((m = l.match(/^Image: (\d\.\d) stars ([\d,]+) Reviews?$/))) { cur.rating = +m[1]; cur.reviews = +m[2].replace(/,/g, ""); }
    else if (/^Hyperlink: Visit .*website$/.test(l)) cur.website = "shown (address not exposed by the page text)";
    else if ((m = l.match(/^Text: (\(\d{3}\) \d{3}-\d{4})$/))) cur.phone = m[1];
    else if ((m = l.match(/^Text: (.+)$/))) {
      const t = m[1];
      if (/^sponsored$|^ad$/i.test(t)) cur.sponsored = true;
      else if (!cur.category && cur.rating !== null && !/^(Open|Closed|Closes|Opens|·|"|\(|\d)/.test(t)) cur.category = t;
      else if (!cur.address && /^\d/.test(t) && !/^\d+ (AM|PM)/.test(t)) cur.address = t;
    }
  }
  return rows.map(({ _raw, ...r }) => r);
}

const VP_LINE = /^VIEWPORT:\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+)z$/;
const num5 = (x) => Number(x).toFixed(5);
// Is this row the client's? The one rule both paths use (the name, case-insensitive; never a domain or a phone).
const isOurs = (r, biz) => r.name.toLowerCase() === biz.name.toLowerCase();

// The tail both paths share: never over a capture that has "method"; an old-form file of the same name is moved aside first; then written (wx).
function commit(grid, req, cap) {
  const file = path.join(grid, req.captureFile);
  const orig = path.join(CONVERT, "originals", "grid", req.captureFile);
  let moved = false;
  if (fs.existsSync(file)) {
    const old = J(file);
    refuse(old && typeof old === "object" && !Array.isArray(old), `${req.captureFile}: the existing capture is not a JSON object`);
    refuse(!("method" in old), `${req.captureFile} is already captured (it holds "method": ${JSON.stringify(old.method)})`);
    refuse(!fs.existsSync(orig), `originals/grid/${req.captureFile} exists already: the old capture is not moved over it`);
    moved = true;
  }
  const out = JSON.stringify(cap, null, 1) + "\n";
  if (moved) {
    fs.mkdirSync(path.dirname(orig), { recursive: true });
    const before = facts(file);
    fs.renameSync(file, orig);
    const after = facts(orig);
    if (before.sha256 !== after.sha256 || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Refused(`${req.captureFile}: moved to ${orig} and the new file NOT written, because its sha256, size or write time changed (${JSON.stringify(before)} vs ${JSON.stringify(after)})`);
    console.log(`moved ${req.captureFile} -> ${orig} (sha256 ${after.sha256.slice(0, 12)}, ${after.size} B, written ${after.mtime}: unchanged)`);
  }
  fs.writeFileSync(file, out, { flag: "wx" });
  return file;
}

function main() {
  const grid = path.join(PEWP, "captures", "local", "grid");
  refuse(typeof CAPTURED_IN === "string" && CAPTURED_IN.trim() !== "", `--captured-in is missing or empty`);
  refuse(fs.existsSync(RAW) && fs.statSync(RAW).isFile(), `--raw ${RAW} is not a file`);
  const buf = fs.readFileSync(RAW);
  const text = buf.toString("utf8").split(/\r?\n/);
  const head = parseHeader(text[0]);
  refuse(head && head.id, `${path.basename(RAW)}: line 1 is not a "# i=.. id=.." header`);
  const reqs = J(path.join(grid, "requests.json")).requests;
  refuse(Array.isArray(reqs), "requests.json has no requests[]");
  const req = reqs.find((r) => r && r.id === head.id);
  refuse(req, `id ${head.id} is not in requests.json`);
  refuse(typeof req.captureFile === "string" && req.captureFile === path.basename(req.captureFile) && /\.json$/.test(req.captureFile), `${req.id}: captureFile is not a plain .json file name: ${JSON.stringify(req.captureFile)}`);
  refuse(req.point && typeof req.point.lat === "number" && typeof req.point.lng === "number", `${req.id}: the request has no numeric point lat and lng`);

  const grp = text.map((l) => l.trim()).find((l) => /^Group: Results for /.test(l));
  refuse(grp && grp.replace("Group: Results for ", "") === req.query, `the page shows ${JSON.stringify(grp ?? null)}, the request's query is ${JSON.stringify(req.query)}`);
  refuse(!/unusual traffic|not a robot|recaptcha|before you continue/i.test(text.join(" ")), `the page text holds a robot-check sign (unusual traffic, not a robot, recaptcha or before you continue)`);

  const vpLines = [...new Set(text.map((l) => l.trim()).filter((l) => l.startsWith("VIEWPORT:")))];
  refuse(vpLines.length > 0, `the page text holds no VIEWPORT: line`);
  refuse(vpLines.length === 1, `the page text holds ${vpLines.length} different VIEWPORT: lines`);
  const vm = VP_LINE.exec(vpLines[0]);
  refuse(vm, `the VIEWPORT line is not "VIEWPORT: <lat>,<lng>,<whole zoom>z": ${JSON.stringify(vpLines[0])}`);
  const viewport = { lat: Number(vm[1]), lng: Number(vm[2]), zoom: Number(vm[3]) };
  refuse(Math.abs(viewport.lat - req.point.lat) <= TOL && Math.abs(viewport.lng - req.point.lng) <= TOL,
    `the viewport ${viewport.lat},${viewport.lng} is more than ${TOL} from the request's point ${req.point.lat},${req.point.lng}`);
  refuse(head.readAtUtc, `the header has no readAtUtc`);
  refuse(/^-?\d+$/.test(head.idleMsBeforePage ?? "") && /^-?\d+$/.test(head.sinceOwnInputMsBeforePage ?? ""),
    `the header has no idleMsBeforePage and sinceOwnInputMsBeforePage numbers (a page read before the human-idle rule is not converted)`);

  const biz = J(path.join(PEWP, "business.json"));
  refuse(biz && typeof biz.name === "string" && biz.name, "business.json has no name");

  const pack = parseRows(text.slice(1)).slice(0, 20);
  const ours = pack.find((r) => isOurs(r, biz));
  const cap = {
    id: req.id, query: req.query, city: req.city, location: req.location,
    method: "maps-viewport", viewport,
    locationShown: `Google Maps viewport ${num5(viewport.lat)},${num5(viewport.lng)} zoom ${viewport.zoom} (read back from the address bar after the list loaded; hl=en gl=us); the page has no footer place name, this is a viewport read, not a device location`,
    device: "desktop", language: req.language, point: req.point,
    capturedAt: head.readAtUtc, capturedIn: CAPTURED_IN,
    robotCheck: false, firstListOnly: true,
    humanIdleBeforePage: { idleMs: +head.idleMsBeforePage, sinceOwnLastInputMs: +head.sinceOwnInputMsBeforePage, rule: "no input since mine (idle >= since-own - 2 s); first page: idle >= 120 s" },
    ourPosition: ours ? ours.position : null, pack,
    notes: "The first results list as loaded (no scrolling), read as page text through UI Automation. Positions are list order, sponsored rows included when the page marks them. Website addresses are not exposed by the page text.",
    rawFile: { name: path.basename(RAW), sha256: shaOf(buf) },
  };

  const file = commit(grid, req, cap);
  console.log(`${req.id} rows=${pack.length} ours=${ours ? ours.position : "-"} sponsored=${pack.filter((r) => r.sponsored).length} viewport=${viewport.lat},${viewport.lng},${viewport.zoom} -> ${file}`);
}

// ---- --card: the "single place card" page ----
const CARD_KEYS = ["i", "id", "runnerLine", "addressBar", "fg", "vp", "kbfocus", "readAtUtc"];
// "# i=100 id=<id> runnerLine=<free text> addressBar=CHECK fg=ok vp=<lat>,<lng>,<zoom>z kbfocus=False readAtUtc=<ISO>"
// runnerLine is free text, so i and id are read from their FIRST occurrence (they come before it) and the later keys from their LAST.
function parseCardHeader(line) {
  const s = String(line ?? "").replace(/^\uFEFF/, "");
  if (!/^#\s/.test(s)) return null;
  const hits = [...s.matchAll(new RegExp(`(?:^|\\s)(${CARD_KEYS.join("|")})=`, "g"))];
  const head = {};
  for (let k = 0; k < hits.length; k++) {
    const key = hits[k][1], from = hits[k].index + hits[k][0].length;
    const to = k + 1 < hits.length ? hits[k + 1].index : s.length;
    if ((key === "i" || key === "id") && key in head) continue;
    head[key] = s.slice(from, to).trim();
  }
  return head;
}

const indentOf = (s) => s.match(/^\s*/)[0].length;
// A place group: "Group: <name>" whose block (the deeper-indented lines after it) holds "Text: <name>" and "Group: Information for <name>".
function placeGroups(lines) {
  const found = [];
  lines.forEach((raw, g) => {
    const m = /^\s*Group: (.+?)\s*$/.exec(raw);
    if (!m) return;
    const name = m[1], ind = indentOf(raw);
    let e = g + 1;
    while (e < lines.length && (lines[e].trim() === "" || indentOf(lines[e]) > ind)) e++;
    const t = lines.slice(g + 1, e).map((l) => l.trim());
    if (t.includes(`Text: ${name}`) && t.includes(`Group: Information for ${name}`)) found.push({ name, t });
  });
  return found;
}

// The one row of a card. Everything comes from this place's own block; the rating and reviews only from its header lines
// (after "Text: <name>", before "Group: Actions for <name>"), never from the "People also search for" block below.
function cardRow({ name, t }) {
  const iName = t.indexOf(`Text: ${name}`), iInfo = t.indexOf(`Group: Information for ${name}`), iAct = t.indexOf(`Group: Actions for ${name}`);
  const hdrEnd = iAct > iName ? iAct : iInfo > iName ? iInfo : t.length;
  const hdr = t.slice(iName + 1, hdrEnd);
  let infoEnd = t.findIndex((l, k) => k > iInfo && (/^Group: /.test(l) || l === "Text: People also search for"));
  if (infoEnd < 0) infoEnd = t.length;
  const info = t.slice(iInfo + 1, infoEnd);
  const pick = (lines, re) => { for (const l of lines) { const m = re.exec(l); if (m) return m; } return null; };
  const cat = hdr.find((l) => /^Button: /.test(l) && !/^Button: (Photo|See photos)/i.test(l));
  // A header line SPEAKS OF A RATING when, with the place's own name taken out (any case), it names stars, reviews or a rating, or its text
  // after the first ": " is only a number or only a number in round brackets. None: no rating. Exactly one and it is the list's own line:
  // read it. Anything else is refused, never written as "no rating".
  const without = (l) => l.toLowerCase().split(name.toLowerCase()).join(" ");
  const speaks = (l) => /\bstars?\b|\breviews?\b|\brat(?:ed|ing)s?\b/i.test(without(l)) || (l.includes(": ") && /^(?:\d+(?:\.\d+)?|\(\d[\d,]*\))$/.test(l.slice(l.indexOf(": ") + 2).trim()));
  const rated = hdr.filter(speaks);
  const lm = rated.length === 1 ? /^Image: (\d\.\d) stars ([\d,]+) Reviews?$/.exec(rated[0]) : null;
  refuse(rated.length === 0 || lm, `the card's header holds a rating line this reader has not met: ${(rated[0] ?? "").slice(0, 80)}`);
  const addr = pick(info, /^Button: Address: (.+)$/), phone = pick(info, /^Button: Phone: (.+)$/);
  const site = pick(info, /^(?:Button|Hyperlink): Website: (.+)$/);
  return {
    position: 1, name,
    rating: lm ? +lm[1] : null, reviews: lm ? +lm[2].replace(/,/g, "") : null,
    category: cat ? cat.slice("Button: ".length).trim() : null,
    address: addr ? addr[1].trim() : null, phone: phone ? phone[1].trim() : null,
    website: site ? site[1].trim() : pick(info, /^Hyperlink: (?:Visit .*website|Open website)$/) ? "shown (address not exposed by the page text)" : null,
    sponsored: false,
  };
}

function mainCard() {
  const grid = path.join(PEWP, "captures", "local", "grid");
  refuse(typeof CAPTURED_IN === "string" && CAPTURED_IN.trim() !== "", `--captured-in is missing or empty`);
  refuse(fs.existsSync(CARD) && fs.statSync(CARD).isFile(), `--card ${CARD} is not a file`);
  const buf = fs.readFileSync(CARD);
  const text = buf.toString("utf8").split(/\r?\n/);
  const body = text.slice(1);   // the header (line 1) is the helper's own words (its runnerLine may say "not a robot check"): never judged as page text

  refuse(!body.some((l) => /^Group: Results for /.test(l.trim())), `the page holds a "Group: Results for" line: it is a results list, not a single place card (use --raw)`);
  refuse(!/unusual traffic|not a robot|recaptcha|before you continue/i.test(body.join(" ")), `the page text holds a robot-check sign (unusual traffic, not a robot, recaptcha or before you continue)`);
  const places = placeGroups(body);
  refuse(places.length === 1, `the page holds ${places.length} place groups (a Group with a Text of its own name and a "Group: Information for" it); a card page holds exactly 1`);

  const head = parseCardHeader(text[0]);
  refuse(head, `${path.basename(CARD)}: line 1 is not a "# i=.. id=.. vp=.. readAtUtc=.." header`);
  for (const k of ["i", "id", "vp", "readAtUtc"]) refuse(head[k], `the header has no ${k}=`);
  const reqs = J(path.join(grid, "requests.json")).requests;
  refuse(Array.isArray(reqs), "requests.json has no requests[]");
  const req = reqs.find((r) => r && r.id === head.id);
  refuse(req, `id ${head.id} is not in requests.json`);
  refuse(typeof req.captureFile === "string" && req.captureFile === path.basename(req.captureFile) && /\.json$/.test(req.captureFile), `${req.id}: captureFile is not a plain .json file name: ${JSON.stringify(req.captureFile)}`);
  refuse(req.point && typeof req.point.lat === "number" && typeof req.point.lng === "number", `${req.id}: the request has no numeric point lat and lng`);

  const vpLines = [...new Set(text.map((l) => l.trim()).filter((l) => l.startsWith("VIEWPORT:")))];
  refuse(vpLines.length > 0, `the page text holds no VIEWPORT: line`);
  refuse(vpLines.length === 1, `the page text holds ${vpLines.length} different VIEWPORT: lines`);
  const vm = VP_LINE.exec(vpLines[0]);
  refuse(vm, `the VIEWPORT line is not "VIEWPORT: <lat>,<lng>,<whole zoom>z": ${JSON.stringify(vpLines[0])}`);
  const viewport = { lat: Number(vm[1]), lng: Number(vm[2]), zoom: Number(vm[3]) };
  const hm = VP_LINE.exec(`VIEWPORT: ${head.vp}`);
  refuse(hm, `the header vp is not "<lat>,<lng>,<whole zoom>z": ${JSON.stringify(head.vp)}`);
  refuse(Number(hm[1]) === viewport.lat && Number(hm[2]) === viewport.lng && Number(hm[3]) === viewport.zoom,
    `the header vp ${head.vp} and the page's ${vpLines[0]} are not the same three numbers`);
  refuse(Math.abs(viewport.lat - req.point.lat) <= TOL && Math.abs(viewport.lng - req.point.lng) <= TOL,
    `the viewport ${viewport.lat},${viewport.lng} is more than ${TOL} from the request's point ${req.point.lat},${req.point.lng}`);
  refuse(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(head.readAtUtc) && !Number.isNaN(Date.parse(head.readAtUtc)), `the header readAtUtc ${JSON.stringify(head.readAtUtc)} is not an ISO time`);

  const biz = J(path.join(PEWP, "business.json"));
  refuse(biz && typeof biz.name === "string" && biz.name, "business.json has no name");

  const pack = [cardRow(places[0])];
  const ours = pack.find((r) => isOurs(r, biz));
  const cap = {
    id: req.id, query: req.query, city: req.city, location: req.location,
    method: "maps-viewport", viewport,
    locationShown: `Google Maps viewport ${num5(viewport.lat)},${num5(viewport.lng)} zoom ${viewport.zoom} (the helper's header vp and the page's own VIEWPORT line, the same three numbers); the page has no footer place name, this is a viewport read, not a device location`,
    device: "desktop", language: req.language, point: req.point,
    capturedAt: head.readAtUtc, capturedIn: CAPTURED_IN,
    robotCheck: false, firstListOnly: true,
    humanIdleBeforePage: null,
    ourPosition: ours ? ours.position : null, pack,
    notes: "Google Maps opened one place's card for this search at this viewport, not a results list; the pack holds that one place (read from its own card only: name, category, address, phone, website, and rating and reviews when its header shows them). The two human-idle numbers of the runner are not in this text: null.",
    singlePlaceCard: true,
    rawFile: { name: path.basename(CARD), sha256: shaOf(buf) },
  };
  const file = commit(grid, req, cap);
  console.log(`${req.id} rows=1 ours=${ours ? ours.position : "-"} sponsored=0 viewport=${viewport.lat},${viewport.lng},${viewport.zoom} card -> ${file}`);
}

if (!PEWP || !CONVERT || (RAW ? 1 : 0) + (CARD ? 1 : 0) !== 1) {
  console.error(`usage: node grid-text-to-capture.mjs --pewp <run .pewp> (--raw <one list text> | --card <one card text>) --convert <dir> --captured-in "<text>"   (exactly one of --raw and --card)`);
  process.exitCode = 2;
} else {
  try { CARD ? mainCard() : main(); } catch (e) {
    if (e instanceof Refused) { console.error(`REFUSED: ${e.message}`); process.exitCode = 1; }
    else { console.error(`CRASH: ${e && e.stack ? e.stack : e}`); process.exitCode = 4; }
  }
}
