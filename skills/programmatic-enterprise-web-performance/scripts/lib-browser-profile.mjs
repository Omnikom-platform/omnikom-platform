// The ONE place a script starts Chrome or Edge on a profile folder it made (machine-health fix, 2026-11-11).
// WHY: the first start of Chrome or Edge on a brand-new --user-data-dir checks whether the Windows account has a blank password, and does it by trying to log on as
// that account with an EMPTY password: one failed logon per fresh profile. Ten close together lock the account (five lockouts on 2026-11-11 morning). The check is
// skipped when the profile's "Local State" already says the password is not blank and when it was last changed, so a fresh profile is SEEDED with that file BEFORE the
// browser is spawned. Every launcher goes through spawnBrowser(); test-browser-profile.mjs fails when a script names --user-data-dir anywhere else, or spawns a browser
// on its own. Not covered: Playwright's own browser launch (lib-shots.mjs): it makes its own profile and refuses a --user-data-dir flag, see the guard test.
import nodeFs from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";

// Windows FILETIME-style stamp Chrome writes: microseconds since 1601-01-01, as a string
export const chromeTime = (ms) => String((BigInt(ms) + 11644473600000n) * 1000n);

/** Make `dir` and write (merge into) its "Local State" so the browser does not probe the OS account. Returns the object written. */
export function seedProfile(dir, { fs = nodeFs, now = Date.now } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "Local State");
  let state = {};
  try {
    const parsed = JSON.parse(String(fs.readFileSync(file, "utf8")).replace(/^﻿/, ""));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) state = parsed; // anything else (or unreadable) is not a state worth keeping
  } catch { /* no file yet, or not JSON: start clean */ }
  const pm = state.password_manager && typeof state.password_manager === "object" && !Array.isArray(state.password_manager) ? state.password_manager : {};
  state = { ...state, password_manager: { ...pm, os_password_blank: false, os_password_last_changed: chromeTime(now()) } };
  fs.writeFileSync(file, JSON.stringify(state));
  return state;
}

/** For a profile that holds sign-ins (the audit profile): leave a good "Local State" exactly as it is (rewriting it can lose the key that opens the saved sign-ins).
 *  Missing: seed as seedProfile does. Present but unreadable or not a JSON object: throw, touch nothing. Parses but does not say os_password_blank is false: seed (merge). */
export function keepLocalState(dir, io = {}) {
  const fs = io.fs || nodeFs;
  const file = path.join(dir, "Local State");
  let raw;
  try { raw = String(fs.readFileSync(file, "utf8")); } catch (e) { if (e && e.code === "ENOENT") return seedProfile(dir, io); throw e; }
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^﻿/, "")); } catch { throw new Error(`Local State cannot be parsed, left as it is: ${file}`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Local State cannot be parsed, left as it is: ${file}`);
  if (parsed.password_manager?.os_password_blank === false) return parsed;
  return seedProfile(dir, io); // parses, but does not say false
}

/** Seed the profile, THEN spawn the browser on it: `<exe> --user-data-dir=<dir> ...args`. io.spawn and io.fs are injectable for tests.
 *  io.keepState: true keeps a good existing "Local State" untouched (keepLocalState); without it nothing differs from before. */
export function spawnBrowser({ exe, dir, args = [], options = {} }, io = {}) {
  if (io.keepState) keepLocalState(dir, io);
  else seedProfile(dir, io);
  return (io.spawn || nodeSpawn)(exe, [`--user-data-dir=${dir}`, ...args], options);
}
