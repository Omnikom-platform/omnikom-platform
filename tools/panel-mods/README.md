# Panel mods (Claude app side panels)

`elev8-tracker/`: the phase tracker panel from the ELEV8 audit (2026-10-26). It reads a project's `icm/TRACKER.json` every 20 s and
shows each phase, its items (a path on disk, optional `contains` text, or `any` of several paths; `*` allowed in a path segment),
what can start now and what each phase waits on. Nothing is ticked by hand: an item is done when its file is on disk.

To reuse: copy the folder into the session's dev-mods folder (the plugin-authoring skill names it), change `TRACKER` at the top of
`hooks/register.tsx` to the new project's `icm/TRACKER.json`, rename the mod in `.claude-plugin/plugin.json`, then
`claude plugin validate <folder>` and `claude plugin test <folder>`. The generated `.claude-plugin/types/` folder is left out here;
the engine writes it when the mod loads.
