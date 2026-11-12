// The record of a client audit run (today {pewp}/seo-run.json, the file `omnikom seo run` keeps): read it and write it, nothing else. Built-ins only; prints nothing, never exits.
//   readRun(file)         -> { run }                 the parsed record (version 1 with a steps list), or { run: null } when there is no file
//                          | { run: null, error }     a file that cannot be read as a record (the text says to delete it, or to run with --fresh)
//   writeRun(file, run)   a temporary file, then a rename: a reader never sees half a record
import fs from "node:fs";

export function readRun(file) {
  if (!fs.existsSync(file)) return { run: null };
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j && j.version === 1 && Array.isArray(j.steps)) return { run: j };
  } catch { /* below */ }
  return { run: null, error: `the run log ${String(file).replace(/\\/g, "/")} is not readable (delete it, or run with --fresh)` };
}

export function writeRun(file, run) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(run, null, 1) + "\n");
  fs.renameSync(tmp, file);   // a reader never sees half a log
}
