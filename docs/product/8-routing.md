# Routing

Every route in the product, in one place. "Now" means the route is in the code on master; "MISSING" means a feature in
`1-product.md` needs it and no code serves it.

## User dashboard (`apps/dashboard/src/router.tsx`)

One app, one magic-link sign-in. The CRM's routes sit under `leads`; the dashboard's under `site` (the media library too), `publish` and
`settings`.

| Route | Shows | State |
|---|---|---|
| `/` | sends to `/w` or `/login` | now |
| `/login` (`?expired`, `?ended`) | ask for a sign-in link | now |
| `/auth/confirm` | the link from the sign-in mail lands here | now |
| `/w` | pick a business | now |
| `/w/$ws` | the Overview | now |
| `/w/$ws/leads` | the CRM lead list | now |
| `/w/$ws/leads/new` | add a lead by hand | now |
| `/w/$ws/leads/$id` | the lead record | now |
| `/w/$ws/leads` with a saved view, the status board, import and export layout | CRM views, board, import and export | MISSING (routes decided with the screens) |
| `/w/$ws/site` | pages and collections from the contract, the publish sheet | now |
| `/w/$ws/site/$collection/$row` (`?field`) | the item editor with history | now |
| `/w/$ws/site/media` | the media library (a member: its own uploads) | now |
| (no route) | publish history and restore | a sheet on the Site screen (B11) |
| `/w/$ws/settings` | one Settings screen of cards | MISSING |
| `/w/$ws/sites/$site/search` | the Search health page of a site (owners and staff; a member lands on the Overview) | now (book row B24) |
| anything else | not found | now |

Not routes, by decision: `/invite/:token` (an invite is a sign-in link), `/reset` (no passwords), `/admin/*` (no staff
screens).

## Edge Functions (`supabase/functions/`, base `/functions/v1/`)

| Path | Caller | Credential |
|---|---|---|
| `save`, `drafts`, `publish` | dashboard | user JWT |
| `upload-start`, `upload-finish` | dashboard | user JWT |
| `add-lead`, `lead-update`, `lead-export` | dashboard | user JWT |
| `invite-member`, `settings-save`, `team-list`, `member-remove` | dashboard (owner) | user JWT |
| `capture-lead?site=<id>&visitor=<hash>` | the site's `/api/lead` | `X-Site-Signature` |
| `export-published?job=<uuid>` (GET) | publish runner | `X-Runner-Signature` |
| `job-callback` (POST) | publish runner | `X-Runner-Signature` |
| `media-export?media=<uuid>` (GET) | media runner | `X-Runner-Signature` |
| `media-process-callback` (POST) | media runner | `X-Runner-Signature` |

The runner signs the path after `PLATFORM_FUNCTIONS_BASE`, never the `/functions/v1` prefix. Answers use plain codes: `401
SIGNATURE`, `404 S-NOT-FOUND`, `409 S-JOB-BUSY`, `409 S-JOB-STATE`, `409 S-LIMIT`, `413`, `422 I-*`, `429 S-QUOTA`, `500 CONFIG`. Every answer
carries the call's request id in the header `x-request-id` (M32: the same id starts every log line of the call); a problem answered by the
shared frame (`_shared/http.ts`) also carries it in its body as `request_id`, while `capture-lead`'s own problems carry it in the header
only. The OpenAPI file `docs/blueprint/specs/openapi.json` describes the functions and is checked by the gates.

GitHub entry points: `workflow_dispatch` on `publish.yml` with `job_id`, `site_id`, `force_fail` (the platform sends the first two) and on
`media.yml` with `media_id`, `workspace_id`, ref `master`, sent with `GITHUB_DISPATCH_TOKEN_V2`; while only the old token is set, `repository_dispatch`
types `publish` (`{job_id, site_id}`) and `media` (`{media_id, workspace_id}`).

## A business website (built by `factory/build.mjs`)

| Route | Is |
|---|---|
| pages from the contract's `pages` | the plan's pages, by path |
| item routes from each collection's `route` (for example `/listings/{slug}/`) | one page per published item |
| `POST /api/lead` | the lead form endpoint (Pages Function); JSON or a plain form |
| `GET /api/lead?sent=1` | the thank-you page when the site sets no `THANKS_PATH`; any other GET gets 405 |
| `/sitemap.xml`, `/robots.txt`, `/llms.txt` | generated from the placed pages |
| `/404.html` | not found |
| `_headers`, `_redirects` | security headers; redirects from the `redirects` collection and deleted items |
| `/media/<path>`, `/assets/<name>.<sha>.css` and `.js` | photos and hashed assets |

Addresses: `<project>.pages.dev` (noindex until launch), `preview.<project>.pages.dev` (staging, always noindex), the client's
domain once attached. The platform's domain is `omnikom.ai` (owner, 2026-11-05): the dashboard is `app.omnikom.ai` in
production; staging runs on its Pages address (`omnikom-app-staging.pages.dev`) until a staging name is set. `omnikom.io` is the
company's own domain and is not used by the platform.
