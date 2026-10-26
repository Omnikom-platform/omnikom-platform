import { expect, test } from 'claude-code/testing'

// A small disk: the tracker list, the phase map, one file present, one glob folder present, one file missing.
const ROOT = 'E:/Alex Sevilla'
const TRACKER = {
  root: ROOT,
  statusFile: 'icm/phase-0/CONTEXT.md',
  phases: [
    { id: 'P0.1', title: 'Website backup', owner: 'Researcher', items: [
      { label: 'Backup verified', path: 'backups/www.elev8ca.com_*/verify.json' },
      { label: 'Report', path: 'icm/work/p0.1/REPORT.md' },
      { label: 'Gate passed', path: 'icm/gate/BACKUP-GATE.md', contains: 'BACKUP VERIFIED' },
    ], waitsOn: [], because: 'nothing' },
    { id: 'P0.2', title: 'Profile', owner: 'Researcher', items: [
      { label: 'Profile draft', path: 'icm/work/p0.2/PROFILE-draft.md' },
    ], waitsOn: ['P0.1'], because: 'after the verified backup' },
  ],
}
const FILES: Record<string, string> = {
  [`${ROOT}/icm/TRACKER.json`]: JSON.stringify(TRACKER),
  [`${ROOT}/icm/phase-0/CONTEXT.md`]: '| P0.1 | Website backup | Researcher | x | y | IN PROGRESS |\n',
  [`${ROOT}/backups/www.elev8ca.com_2026-10-26/verify.json`]: '{}',
  [`${ROOT}/icm/gate/BACKUP-GATE.md`]: '# Backup gate\n(not run yet)\n',
}
const p = (path: string) => path.replace(/\\/g, '/')
const DIRS: Record<string, string[]> = { [`${ROOT}/backups`]: ['www.elev8ca.com_2026-10-26'] }

const PANE = {
  plugin: 'elev8-tracker',
  component: 'Pane',
  requestId: 'elev8-tracker',
  props: { title: 'ELEV8 audit', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the pane ticks only what is on disk, and reads the phase status', async ($, on) => {
  on('command.register', () => ({ value: { command: 'elev8' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 26, 12, 0, 0) }))
  on('clock.every', () => ({ value: undefined }))
  on('fs.read', (_, e) => (p(e.path) in FILES ? { value: FILES[p(e.path)] } : { deny: 'ENOENT' }))
  on('fs.list', (_, e) => ({ value: (DIRS[p(e.path)] ?? []).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.stat', (_, e) =>
    p(e.path) in FILES ? { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }
      : p(e.path) in DIRS ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
        : { deny: 'ENOENT' })

  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /files on disk/ }))?.text).toBe('1 of 4 files on disk')
  // P0.1 waits on nothing and is not complete: ready. P0.2 waits on the incomplete P0.1: waiting, with the reason.
  expect((await ui.find({ type: 'Text', text: /Can start now/ }))?.text).toBe('Can start now: P0.1')
  expect((await ui.find({ type: 'Text', text: /waits on/ }))?.text).toBe('waits on P0.1: after the verified backup')
  expect((await ui.find({ type: 'Text', text: /Backup verified/ }))?.text).toContain('✓')
  expect((await ui.find({ type: 'Text', text: /Report/ }))?.text).toContain('·')
  // The gate file exists but has no marker line: not ticked.
  expect((await ui.find({ type: 'Text', text: /Gate passed/ }))?.text).toContain('·')
  expect((await ui.find({ type: 'Text', text: /Researcher ·/ }))?.text).toBe('Researcher · IN PROGRESS · 1/3')
  await ui.unmount()
})
