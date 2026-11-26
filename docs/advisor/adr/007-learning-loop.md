# ADR 007: Learning loop: Targeting offline, never live

Status: accepted by the head 2026-11-26 20:45 (rulings in R2 section 24). Design: `docs/advisor/R2-design.md`.

## Context
Brief constraint 7: it never learns live (Tay, 16 hours, R1). It keeps only the misses, with personal data removed before storage. It goes from the offline tests to shadow, then a small share,
with an approver, a log entry and a one-step rollback. Storing redacted visitor text: the owner said yes for omnikom.io only (2026-11-26 20:50); OFF on client sites until each one's privacy page covers it.

## Decision
The pipeline is in R2 section 11:
1. Collect the redacted misses: one report per session, none when GPC is set.
2. Store them for 30 days.
3. Target them weekly: a person adds phrasings, concepts or sourced claims.
4. Gate: validator, golden transcripts, zero cp11 drops, mutants, held-back.
5. Shadow: report only the turns that differ.
6. Small share: 10% of sessions for at least 7 days. Shadow and small share apply to later pack versions only, and only while the session report is on (the head, 2026-11-26).
   The report is ON for omnikom.io only (the owner, 2026-11-26 20:50) and OFF on client sites until each one's privacy page covers it.
7. A named approver signs, and a log entry is written.
8. Rollback is one step: point back to the previous pack.

## Consequences
The assistant gets better by a person's hand, at a weekly pace. Visitors cannot teach it anything. This review is the service the client pays for (M310).

## Open
The owner's decision on storing redacted text; the endpoint's home and cost (UNPROVEN).
