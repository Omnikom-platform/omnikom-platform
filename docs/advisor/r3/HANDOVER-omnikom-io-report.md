# Hand-over to OMNIKOM-IO-SITE: the Advisor's session report on omnikom.io

Written 2026-11-27 18:00 by ADVISOR-ENGINE for PARK A1 point 2c. It goes through the head; OMNIKOM-IO-SITE builds it in the lovable repo.
Design: `docs/advisor/r3/HANDOVER-collector.md` (the head's GO 08:20; intake accepted 16:10). The code comes from code/main
`factory/advisor/report/`, which lands with the advisor chain (its top is b1d2df62 now).

## Who ships what
- **The endpoint** `/api/advisor-report` is a Pages Function inside the omnikom-live build that OMNIKOM-IO-SITE deploys, next to
  `/api/lead`. ADVISOR-ENGINE deploys nothing.
- **The KV namespace, its binding and REPORT_SALT** come from one command that ADVISOR-ENGINE runs on the head's go (section 6).
  They take effect at omnikom-live's next production deployment, which is OMNIKOM-IO-SITE's deploy.
- **The order:**
  1. The privacy paragraph (section 5) goes live, either in the same deploy as the client call or before it, never after it.
  2. The head gives the go, and section 6 runs.
  3. OMNIKOM-IO-SITE deploys the build with the function and the client call.
- **Before the binding exists**, the endpoint answers 503 and stores nothing.

## 1. The four files, copied byte for byte with their sha256 pinned
- **What to copy:** after the chain lands, copy each file from code/main master (`git show <master>:factory/advisor/report/<file>`) into
  `lovable-app/src/lib/advisor-report/`. Do not edit them; a change comes from code/main.
- **The check:** a test in the lovable repo checks every copy against this table. This is ruling 1 in R2 section 24: "a check that the copy
  equals the release; never a second source".
- **Why four files and not one:** the endpoint imports `redact.mjs` and `policy.mjs`, and the browser side imports the same two.

| file | sha256 (the blob at b1d2df62; unchanged since f97ce64b) |
|---|---|
| `policy.mjs` | `8fc38e58b76be023717c1a38ff53deea0989427730b7e21ff202c5ce4faf5f71` |
| `redact.mjs` | `f5e82d8ffad683ed0198d3eccf82df31749288f9fa43d8af2cb838d61c597ede` |
| `collect.mjs` | `0881477d375c2e758adeb4df144c478f3d007a06f2cc9d2bc0c3b658b45e44e6` |
| `endpoint.mjs` | `b86d8b29289313251ce3ab4dda2d71821da47c5b819c44b94979404b9a257d54` |

## 2. The endpoint: `lovable-app/deploy/functions/api/advisor-report.js`
```js
/* Cloudflare Pages Function: /api/advisor-report (the Advisor's session report, omnikom.io only). The code is code/main
   factory/advisor/report/endpoint.mjs, copied byte for byte with its sha256 pinned (src/lib/advisor-report/). */
export { onRequest } from "../../../src/lib/advisor-report/endpoint.mjs";
```
- **Why `onRequest` and not `onRequestPost`:** with `onRequest` the 405 for anything but POST is ours.
- **Its bindings:** it reads `env.ADVISOR_REPORTS` and `env.REPORT_SALT` from the project and holds no secret in code. Without them it
  answers 503 and stores nothing.
- **What it never does:** it makes no fetch and writes no log line.

## 3. The client call: `lovable-app/src/lib/advisor-report/report.ts`
```ts
import { createCollector, type Collector } from "./collect.mjs";

const KEY = "omnikom-advisor-session";
const IDLE_MS = 30 * 60 * 1000;
// pack must be "omnikom-io" (the endpoint drops any other); version: at most 32 characters naming the site's engine build.
const PACK = { meta: { pack: "omnikom-io", version: "site-<short lovable sha>", report: true } };

/** A random id per tab, kept in sessionStorage; a new one after 30 minutes away. */
function sessionId(): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { id?: string; at?: number } | null;
    const id = saved?.id && Date.now() - (saved.at ?? 0) < IDLE_MS ? saved.id : crypto.randomUUID();
    sessionStorage.setItem(KEY, JSON.stringify({ id, at: Date.now() }));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

let collector: Collector | undefined;
/** One collector per tab. It sends on pagehide and when the tab is hidden: at most 3 sends, and only when the report changed. */
export function advisorReport(): Collector {
  if (collector) return collector;
  const c = createCollector({ pack: PACK, session: sessionId() });
  const flush = () => { c.send(); };
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  collector = c;
  return c;
}
```
Its types, in `lovable-app/src/lib/advisor-report/collect.d.mts`:
```ts
export type Mark = "qualified" | "planShown" | "handoffOpened" | "didntAnswer";
export interface Collector {
  session: string;
  observe(reply: { band: string; intents?: string[] }, line: string): void;
  mark(event: Mark): void;
  buildReport(name?: string): unknown;
  send(name?: string): boolean;
}
export function createCollector(o: { pack: { meta: { pack: string; version?: string; report?: boolean } }; nav?: Navigator; session?: string }): Collector;
```
- **Browser only.** Call `advisorReport()` only in the browser, inside handlers or effects, never during server rendering.
- **What it sends:** `navigator.sendBeacon('/api/advisor-report', body)` with a JSON string.
- **When it sends nothing:** when the browser has Global Privacy Control on, or when the pack is not `omnikom-io` with `report: true`.
- **No name is passed.** `send()` takes no argument because the site's engine has no name slot. Email addresses, phone numbers and runs
  of 5 or more digits are still removed in the browser and again at the endpoint.

## 4. The calls in `src/components/assistant-card.tsx`
1. **`observe`:** in `answerWithEngine`, just after `engineState.current = state;` (the answer is shown), call
   `advisorReport().observe(reply, text);`. The site's `EngineReply` already carries `band` ("answer" | "clarify" | "fallback") and
   `intents`. Scripted planning turns (`appendScript`) have no band and are not observed.
2. **`mark("planShown")`:** call `advisorReport().mark("planShown")` each time a handoff box is shown. That is where
   `setHandoff(...)` gets a value, in `appendScript` and in `answerWithEngine`.
3. **`mark("handoffOpened")`:** call `advisorReport().mark("handoffOpened")` in the "Request my team plan" link's `onClick`, next to
   `saveHandoff(handoff)`.
4. **`mark("qualified")`:** call `advisorReport().mark("qualified")` once per tab, when the visitor's service first becomes known
   (`knownInterest` goes from undefined to a value).
5. **`didntAnswer`:** do not call it. The site has no "that didn't answer it" control today, so the count stays 0. Adding that control is
   not part of this hand-over.
6. **Start over:** `startOver()` keeps the same collector, so the session and its counts carry on.

## 5. The privacy paragraph: `src/routes/privacy.tsx`, its own section, verbatim
Heading: **Our chat assistant**

"The chat assistant on this site is automated and runs in your browser. It does not ask for your email or phone number; please do not
type personal details into it. When a chat ends, your browser sends us a short report: counts of how the chat went and the questions it
could not answer. Email addresses, phone numbers, long runs of digits and the name you gave are removed in your browser before the report
is sent. We keep these reports for 30 days and use them only to improve the assistant's answers. If your browser sends a Global Privacy
Control signal, no report is sent."

## 6. The outward step: on the head's go, run by ADVISOR-ENGINE from code/main after the chain lands
```
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node factory/advisor/ops/provision.mjs --token-env CLOUDFLARE_IO_ADMIN_TOKEN --apply
```
- **What it changes** (on the Cloudflare account that holds omnikom.io):
  - It creates the Workers KV namespace `ADVISOR_REPORTS`.
  - It binds it as `ADVISOR_REPORTS` on omnikom-live (production).
  - It sets the encrypted secret `REPORT_SALT` (32 random bytes, never printed).
- **What it keeps:** the four existing production secrets stay. The script checks this after the PATCH and exits 1, naming any that
  are missing.
- **The dry run of 2026-11-27:** `docs/advisor/r3/provision-dry-run-2026-11-27.md`.
- **The key (head 21:58):** CLOUDFLARE_IO_ADMIN_TOKEN, the full key on the account that holds omnikom.io. Its write rights are UNPROVEN until --apply runs; a 403 stops the run and goes to the head.

## 7. The checks before the deploy (OMNIKOM-IO-SITE's)
- The sha256 test of the four copies.
- A local Pages run with a local KV, never the production namespace:
  - POST of a report: 204.
  - `Sec-GPC: 1`: 204, and nothing is stored.
  - GET: 405.
  - Without the binding: 503.
- In a browser with GPC on, the chat sends no beacon.
- After the deploy and the binding: one real chat on omnikom.io. Then the head lists the namespace keys and sees one
  `r:<UTC day>:<session>`. This is a report, not a lead; `/api/lead` is never called for it.
