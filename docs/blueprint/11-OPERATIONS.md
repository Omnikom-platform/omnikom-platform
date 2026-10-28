# 11 Operations: observability, runbooks, backup, on-call

Follows the Google SRE book (https://sre.google/sre-book/table-of-contents/): ch. 3 Embracing Risk (error budgets), ch. 4 Service
Level Objectives, ch. 6 Monitoring Distributed Systems, ch. 14 Managing Incidents, ch. 15 Postmortem Culture. Delivery metrics:
DORA (`10-DELIVERY.md` 9).

## 0. SLIs, SLOs and error budgets (SRE ch. 3-4)
| Service | SLI | SLO (monthly) | Error budget |
|---|---|---|---|
| Client sites | share of successful (non-5xx) responses at the edge | 99.9% | ~43 min |
| Form endpoint | share of valid submissions stored (202 with a row) | 99.9% | ~43 min |
| Dashboard | share of successful API reads/writes | 99.5% | ~3.6 h |
| Publish | share of jobs that finish (done or a content-caused fail) within 5 min | 95% | 5% of jobs |
Policy: when a budget is spent, feature releases to that service stop and the next work is reliability, until the 30-day
window recovers. SLO report monthly with the DORA metrics.

## 1. Observability
| Signal | Source | Kept in | Alert when |
|---|---|---|---|
| Function logs (JSON: request id, workspace id, function, code, ms; no personal data) | Edge Functions | Supabase logs (+ export to a log drain later) | error rate > 2% for 10 min |
| Publish jobs | `publish_jobs` + GitHub run logs | DB + GitHub | a job `failed` 2 times in a row for a site; any job > 30 min |
| Lead pipeline | `leads`, `lead_pushes` | DB | a push failed after all retries; 0 leads for a live site with traffic for 7 days (form outage check) |
| Uptime | external checker on each live site, dashboard, form endpoint (synthetic POST to a test site) | `metrics_snapshots` (uptime) | 2 consecutive failures |
| Site quality | nightly gates on every live site | job reports | any gate turns red |
| Speed | PSI weekly (mobile+desktop) on key pages | `metrics_snapshots` | LCP over 4 s lab |
| Database | Supabase dashboard metrics (CPU, connections, slow queries) | Supabase | CPU > 80% 15 min; slow query > 1 s repeated |
| Security | audit_log anomalies (staff actions outside hours, many S-NOT-FOUND from one user) | DB | rule hits |
| Traces | request id passed dashboard -> function -> job -> runner | logs | n/a (for debugging) |
Alerts go to the on-call email + a chat channel (D5 provider). Every alert links its runbook.

## 2. Runbooks (top incidents)
**R1 Publish failed.** 1) Open the job's gate report (dashboard Publish centre / `publish_jobs.gate_report`). 2) If a content rule
failed, the client sees the plain-word reason; help them fix it. 3) If the runner failed (export 401, build error, deploy error),
open the GitHub run, re-run once; if it fails again, check token expiry/secrets, then the factory change that last merged. 4) The
previous deploy stays live; nothing to roll back. 5) Note it in the job and close.

**Incident roles (SRE ch. 14):** incident commander (owner or delegate), operations lead (engineer on call), communications
(Dave for clients). **Postmortems (SRE ch. 15):** blameless, for every S1/S2, with the test that would have caught it.

**R2 Suspected cross-tenant leak (severity 1).** 1) Stop publishing (feature flag `publish_paused` global) and take the affected
site(s) to the previous deploy. 2) Preserve evidence: audit_log, function logs, job exports. 3) Run `tenancy.test.sql` against prod
read-only replica/staging copy; identify the wall that failed. 4) Fix with a test + mutant that reproduce it; two reviewers; deploy.
5) Tell the owner the same day; the owner decides client notification (privacy duty). 6) Write a post-incident note.

**R3 Roll back a deploy.** Site: Cloudflare -> the site's Worker -> deployments -> redeploy previous version (or CLI
`wrangler rollback`); then fix content (restore versions) and publish again. Dashboard: same for the `app` Worker. Database data
loss: Supabase PITR restore to a new project, verify, switch; never restore over prod without the owner; re-enter Vault
secrets only after a manual dump/restore into a new project (restoring to the same project, cloning or branching keeps them
readable; Supabase Vault docs).

**R4 Form outage (leads not arriving).** 1) Synthetic POST to the site's `/api/lead` on a test form. 2) If the Worker fails:
redeploy the last good version. 3) If `capture-lead` fails: function logs; Supabase status. 4) Leads that hit an error were not
stored: the form must show the "please call us" fallback with the phone number (built into every form). 5) Tell the client how
long it was down.

**R5 Lead push failing.** Check `lead_pushes` codes; 401 = CRM secret rotated (ask the client); 5xx = their CRM down (retries
continue); after the last retry the owner sees the lead in the inbox anyway (nothing is lost).

## 3. Backup and restore
Supabase PITR (an add-on on Pro and above that needs a compute add-on; WAL archived about every 2 minutes;
enabling it replaces the daily backups, per the Supabase backups docs) on prod, 7 days; nightly logical dump (schema + data) to an Omnikom-owned bucket, kept 30 days, encrypted.
Storage `media` replicated by nightly sync to the same bucket. **Restore drill every quarter** into a scratch project: restore,
run `tenancy.test.sql`, build one site from the restored data, record the time taken (target: < 2 h).

## 4. On-call basics
Hours: business hours (US Pacific) to start; out of hours only severity 1 (R2, all sites down). Rota: owner + one engineer.
Severity: S1 leak or all sites down (respond 30 min); S2 one site down or forms failing (2 h); S3 a publish failing (next business
day). Every S1/S2 gets a short post-incident note (what, impact, cause, fix, the test added).
