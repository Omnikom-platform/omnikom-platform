# Brief: omnikom CLI slice 3, onboard / offboard / drift (Sonnet builder; one slice, one brief, discarded when done)

Status: WAITING for build steps 6 and 7 (production exists; the tenant onboarding job is specified). Not released. This file is a
placeholder so the slice is not forgotten; the head of the CLI department rewrites it from the step 6 and 7 specs before starting
a builder. It will carry: spec `26-PLATFORM-CLI.md` section 3 (`onboard` row) and DECISIONS 31 (`offboard`: the client keeps the
code and the CRM), the Cloudflare API calls (zone, Pages project, variables) through keys read by name, a `drift` check that
compares the tenant's live configuration with the database, the five rules of spec section 5 verbatim, the gate commands, and the
line "anything outside this brief is a finding you send back, not a fix". Live things (a production project, DNS) need the
owner's click (CLAUDE.md rules 6 and 12): the builder builds against staging and a throwaway Pages project the owner names.
