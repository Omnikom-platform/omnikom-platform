# design-engine

Omnikom's client website design engine: tools that turn real material into gated, measured design. The process is `sops/design-engine.md`;
the quality standard is `CRAFT.md`. First run: ELEV8 Real Estate Group (2026-10-27), kept as `examples/elev8/` (places + map overlay config).

- `render-asset.mjs`: draw in code, render in Chromium, extract the pixels.
- `craft-lint.mjs`: measure a rendered page against CRAFT.md (type/space tokens, contrast, tap targets, orphans, distortion, families, overflow).
- `basemap.mjs` + `templates/map-overlay.html`: a real map of the client's places, toned and annotated in brand colours.
- `fetch-fonts.mjs`, `commons-find.mjs`: self-hosted OFL fonts; freely licensed place photos with licence and author.
- `lib/browser.mjs`: the one browser loader (the skill's lib-shots, this repo's copy first).

Prove it: `node tools/design-engine/tests/test-design-engine.mjs` (21 checks; the basemap checks run offline only when tiles are cached,
because tiles are never committed).
