# Omnikom Platform

Self-serve platform to replace services like Luxury Presence: programmatically SEO-correct client websites (design-first, then
agent-built with the programmatic-enterprise-web-performance skill), a client dashboard (content/SEO publishing, CRM), a multi-tenant
DB, and an internal onboarding engine that researches and scores a business's whole digital presence. Humans only at the website
build step (owner, 2026-10-23).

Status: **analysis written** (`planning/ANALYSIS.md`): five parts (intake & score, client knowledge, website factory, control
center, AI operations) on one shared client record + content contract; proven pieces mapped; build order A-E. Owner decisions
in `planning/DECISIONS.md`. Skills copied into `skills/` (origins in `skills/SOURCE.md`). Next: build step A (presence report
engine) after the weekly usage reset.

## sops/ (standard procedures, proven on real runs)
- `website-backup.md`: back up a site first (our copy of its code), verify it, read a failed gate as tool vs site; traps per platform.
- `clients/prospect-audit-team.md` (moved under `sops/clients/` 2026-10-30, Clients department): the agent team (Lead, Researcher, SEO analyst, Reviewer), write guard, backup gate, gap log, progress
  panel, phase order, where the owner is needed. First run: Example A / Agent A (its project folder), 2026-10-26.

## planning/inputs/ (verbatim, never edited)
- `2026-10-23-chatgpt-omnikom-website-cms-full-chat.md`: owner's ChatGPT conversation about the website + CMS platform (33 KB, copied from Downloads/Telegram Desktop).
- `2026-10-23-owner-draft-deepseek-brief.md`: owner's unfinished brief written for DeepSeek.

## Related, proven pieces elsewhere (to map against later)
- Presence report plan (prospects first): the Example B and D project folder, `icm\work\presence-report-plan.md`
- First real client reports: the Example B and D project folder, the website review under `deliverables\docs\` (+ .pdf)
- Full build-to-launch run (design pass, SEO gate 13/13, forms -> Sheet, Cloudflare, launch tools): the Example C project folder (LAUNCH.md)
- SEO/build skill: `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance\`
