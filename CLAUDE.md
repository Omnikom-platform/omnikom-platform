# Omnikom Platform: Layer 0 (always loaded)

**What this is.** A self-serve platform that replaces services like Luxury Presence: it researches and scores any business's
digital presence, builds a programmatically SEO/AEO/GEO-correct website for it (design first, then agent-built), deploys it, and
runs it from a client dashboard with a lead inbox, while AI operators keep improving it. Owner: Abdo (CTO). Business side: Dave
(CEO, Omnikom). Explain things to the owner in plain words; he is technical-minded but not a specialist in every area.

**Read first, in order:** `.claude/POSITION.md` (where we are; outranks memory) → `planning/DECISIONS.md` (settled, do not
re-open) → `planning/ANALYSIS.md` (the five parts, what is proven, build order A-E) → `planning/CONTEXT.md` (everything learned
building three real client sites: what worked, what broke, where the code is).

## Non-negotiable
1. **Shape is settled** (DECISIONS.md): lead inbox + push to any CRM, follow-up runs on OmniSuite by API key; humans only at
   design approval and fact/legal sign-off on a private preview, domain attached last; one standard procedure for every industry;
   skills live in `skills/` (sync with outside copies on purpose, update `skills/SOURCE.md`).
2. **Done means observed.** A command ran and its pasted output says so, or the page rendered. Write UNPROVEN / NOT DONE / BLOCKED.
   Watched-fail every new check (break it, see it red for the right reason, restore).
3. **Facts carry their source** (file:line, URL + date, or command output). Client-facing claims are never invented: no fake
   reviews, results, licences or numbers.
4. **Public data only, politely.** No logins, no paid data APIs (build our own), never bypass a CAPTCHA or bot wall (stop and
   record it), one HTTP 429 from a host = stop that host. Never submit forms on a client's live site (a test lands in their CRM).
5. **Questions to the owner go as pickable options** (AskUserQuestion, recommended first), never a prose list.
6. **Outward actions need his click:** sending email, publishing, DNS changes, payments, account settings. Drafts are fine.
   In Gmail: fill fields with form_input/JS, never the `type` action; never navigate a tab with an open compose.
7. **Scripts go in files**, not inline `node -e`; long jobs run in the background with bounded waits.
8. **Budget:** the owner sets a weekly usage cap (95% on 2026-10-23); check the usage line before heavy work and say when close.
