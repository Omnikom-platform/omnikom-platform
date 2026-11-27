// The browser side of the session report (docs/advisor/r3/HANDOVER-collector.md, ADR 007 step 1). It watches the engine's replies and the
// widget's marks, keeps counts and up to 20 misses, and sends one beacon to /api/advisor-report when something changed (at most 3 a session).
// Off unless reportAllowed (policy.mjs); the visitor's lines are redacted (redact.mjs) before they leave the browser. The engine is not changed.
// createCollector({ pack, nav = navigator, session }) -> { session, observe(reply, line), mark(event), buildReport(name), send(name) }
import { reportAllowed, REPORT_URL } from './policy.mjs';
import { redact } from './redact.mjs';

export const SENDS_MAX = 3;
export const MISSES_MAX = 20;
const MARKS = ['qualified', 'planShown', 'handoffOpened', 'didntAnswer'];

export function createCollector({ pack, nav = globalThis.navigator, session } = {}) {
  const on = reportAllowed(pack, nav);
  const id = typeof session === 'string' && session ? session : globalThis.crypto.randomUUID();
  const counts = { open: 1, turns: 0, answered: 0, clarify: 0, noMatch: 0, threeNoMatch: 0, qualified: 0, planShown: 0, handoffOpened: 0, didntAnswer: 0 };
  const misses = [];
  let run = 0, asked = null, lastLine = '', lastBand = 'answer', lastSent = null, sends = 0;
  const add = (kind, text, band, top) => { if (misses.length < MISSES_MAX) misses.push({ kind, text: String(text ?? ''), band, top: top.slice(0, 3), turn: counts.turns }); };

  function observe(reply, line) {
    if (!on) return;
    counts.turns++;
    lastLine = String(line ?? '');
    const band = reply?.band;
    lastBand = ['answer', 'clarify', 'fallback', 'abstain'].includes(band) ? band : 'answer';
    if (band === 'fallback' || band === 'abstain') {
      counts.noMatch++;
      run++;
      asked = null;
      add('no-match', lastLine, band, []);
      if (run === 3) { counts.threeNoMatch++; add('three-no-match', lastLine, band, []); }
      return;
    }
    run = 0;
    if (band === 'clarify') { counts.clarify++; asked = lastLine; return; }
    counts.answered++;
    const ids = Array.isArray(reply?.intents) ? reply.intents.filter((x) => typeof x === 'string') : [];
    if (asked !== null) add('clarify-picked', asked, 'clarify', ids);
    asked = null;
  }

  function mark(event) {
    if (!on || !MARKS.includes(event)) return;
    counts[event]++;
    if (event === 'didntAnswer' && counts.turns > 0) add('didnt-answer', lastLine, lastBand, []);
  }

  function buildReport(name) {
    if (!on || counts.turns === 0) return null;
    return { v: 1, pack: pack.meta.pack, packVersion: String(pack.meta.version ?? ''), session: id, counts: { ...counts },
      misses: misses.map((m) => ({ ...m, text: redact(m.text, name), top: [...m.top] })) };
  }

  function send(name) {
    if (sends >= SENDS_MAX) return false;
    const rep = buildReport(name);
    if (!rep) return false;
    const body = JSON.stringify(rep);
    if (body === lastSent) return false;
    let ok = false;
    try { ok = nav.sendBeacon(REPORT_URL, body) === true; } catch { ok = false; }
    if (ok) { lastSent = body; sends++; }
    return ok;
  }

  return { session: id, observe, mark, buildReport, send };
}
