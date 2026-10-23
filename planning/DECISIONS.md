# Owner decisions

## 2026-10-24 (on planning/ANALYSIS.md)

1. **CRM: lead inbox + push to any CRM.** The dashboard holds a lead inbox (list, status, owner, notes, export, webhook). The
   follow-up engine is **OmniSuite**, rented by API key: voice agents, sequences, and MARY's Convert / Cultivate / Recover run
   there. OmniSuite will be expanded to serve this as one of its backbones for leads end to end. The platform pushes leads to
   OmniSuite (or the client's own CRM); it does not rebuild those features.

2. **Humans in the loop: the Rainmaker way.** The site is built and deployed to a private preview automatically; humans do
   **design approval** and **fact/legal sign-off** on the preview; the answers fill the placeholders; the domain is attached last.
   Everything else is automatic: research, scoring, SEO plan, build, gates, deploy, monitoring. Goal: once every step is documented
   and proven, remove the human gates and run fully automatic.

3. **Industries: one standard procedure for every industry.** No pre-built per-industry schemas. The same run works for a realtor,
   an insurance agency or a dog-food chain: the intake research and the SEO plan produce the client's own pages, collections and
   entities, and the content contract is generated from that plan. Consequence: the contract must be generic (sections and
   collections declared by the plan), not hand-written per industry.

4. **Skills live in this repo.** They are copied into `skills/` (the platform's source of truth) and stay usable outside the repo
   for side work. Drift rule: `skills/SOURCE.md` records where each copy came from; changes made outside are synced back on purpose,
   never silently.
