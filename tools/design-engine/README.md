# design-engine

Omnikom's client website design engine: tools that turn real material into gated, measured design. The process is `sops/design-engine.md`;
the quality standard is `CRAFT.md`. First run: Example A Realty Group (2026-10-27), kept as `examples/example-a/` (places + map overlay config).

- `render-asset.mjs`: draw in code, render in Chromium, extract the pixels.
- `craft-lint.mjs`: measure a rendered page against CRAFT.md (type/space tokens, contrast, tap targets, orphans, distortion, families, overflow).
- `basemap.mjs` + `templates/map-overlay.html`: a real map of the client's places, toned and annotated in brand colours.
- `fetch-fonts.mjs`, `commons-find.mjs`: self-hosted OFL fonts; freely licensed place photos with licence and author.
- `ref-capture.mjs`, `ref-fixed.mjs`: S0 reference capture (laptop + phone full pages, structure dump, unloaded-image count) and the
  fixed/sticky UI probe (phone action bars that a full-page shot hides); read only, a robot page stops the host.
- `WRITING.md`: the writing gate, 7 rules (WG-1 to WG-7) for how the engine writes code that is fast and agent-readable; each one a number, enforced in the site build, the skill's `writing-gate.mjs` and the launch ledger.
- `lib/browser.mjs`: the one browser loader (the skill's lib-shots, this repo's copy first).

Prove it: `node tools/design-engine/tests/test-design-engine.mjs` (29 checks; the basemap checks run offline only when tiles are cached,
because tiles are never committed).
