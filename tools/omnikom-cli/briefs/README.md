# Builder briefs for the omnikom CLI (department `cli-and-testing`)

One file per slice. The head of the CLI and testing department writes a brief here before starting its Sonnet builder; the
builder reads only its brief, the spec section it names and the files it lists. A brief is started only when the head of
operations has released its slice (the functions it tests exist on staging). When the slice is done the brief stays as the
record of what the builder was asked; the proof lives in `docs/blueprint/PROGRESS.md` under the slice heading, and the
charter `docs/departments/cli-and-testing.md` gets one position-log line.

| Brief | Slice | Waits for |
|---|---|---|
| `slice-2-functions.md` | the function paths: save, publish, export-published, job-callback, lead-update, add-lead; `verify` grows one check per wall | build step 4 (platform department deploys the functions to staging) |
| `stand-in-flows.md` | the client stand-in flows beyond leads: a content edit and publish as a member, a CRM webhook push, a booking when the add-on exists | slice 2 (publish path) and the `push-lead` function for the CRM part |
| `slice-3-onboard.md` | `onboard`, `offboard`, `drift`, the Cloudflare API calls | build steps 6 and 7 |

Every brief carries, verbatim: the five rules of spec section 5, the gate commands, and the line "anything outside this brief
is a finding you send back, not a fix".
