import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ItemView, PhaseView, TrackerView } from '../types'

// The ELEV8 audit tracker: every phase and every file that must be on disk when the audit is done, top to bottom.
// The list is icm/TRACKER.json in the project; each path is checked on disk here, nothing is ticked by hand.
const TRACKER = 'E:/Alex Sevilla/icm/TRACKER.json'
const PANE = 'elev8-tracker'
const TITLE = 'ELEV8 audit'
const REFRESH_MS = 20000

type Item = { label: string; path?: string; any?: string[]; contains?: string; dir?: boolean }
type Phase = { id: string; title: string; owner: string; items: Item[]; waitsOn?: string[]; because?: string }
type Tracker = { root: string; statusFile: string; phases: Phase[] }

const view = atom({ plugin: 'elev8-tracker', key: 'view' } as const, { checkedAt: 0, phases: [] } as TrackerView)

const join = (a: string, b: string) => `${a.replace(/[\\/]+$/, '')}/${b}`

// Every path matching a pattern whose segments may hold '*' (any name in that folder).
async function expand($: EngineInterface, root: string, pattern: string): Promise<string[]> {
  let found = [root]
  for (const seg of pattern.split('/').filter(Boolean)) {
    const next: string[] = []
    for (const base of found) {
      if (!seg.includes('*')) {
        next.push(join(base, seg))
        continue
      }
      const re = new RegExp('^' + seg.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
      const entries = await $.fs.list(base).catch(() => [])
      for (const en of entries) if (re.test(en.name)) next.push(join(base, en.name))
    }
    found = next
    if (found.length === 0) break
  }
  return found
}

async function isPresentAt($: EngineInterface, path: string, item: Item): Promise<boolean> {
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (!stat) return false
  if (item.dir) return stat.kind === 'dir' && (await $.fs.list(path).catch(() => [])).length > 0
  if (stat.kind !== 'file') return false
  if (!item.contains) return true
  const text = await $.fs.read(path).catch(() => '')
  return typeof text === 'string' && text.includes(item.contains)
}

async function checkItem($: EngineInterface, root: string, item: Item): Promise<ItemView> {
  const patterns = item.any ?? (item.path ? [item.path] : [])
  for (const p of patterns) {
    for (const path of await expand($, root, p)) {
      if (await isPresentAt($, path, item)) return { label: item.label, path: p, isPresent: true }
    }
  }
  return { label: item.label, path: patterns.join(' or '), isPresent: false }
}

// Status per protocol id from the phase map's table: the last cell of each "| P0.x |" row.
function statusById(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\|\s*(P\d+\.\d+)\s*\|/)
    if (!m?.[1]) continue
    const cells = line.split('|').map(c => c.trim()).filter(c => c !== '')
    out.set(m[1], cells[cells.length - 1] ?? '')
  }
  return out
}

async function refresh($: EngineInterface) {
  const checkedAt = await $.clock.now()
  let next: TrackerView
  try {
    const raw = await $.fs.read(TRACKER)
    const tracker = JSON.parse(typeof raw === 'string' ? raw : '{}') as Tracker
    const statusText = await $.fs.read(join(tracker.root, tracker.statusFile)).catch(() => '')
    const statuses = statusById(typeof statusText === 'string' ? statusText : '')
    const phases: PhaseView[] = []
    for (const ph of tracker.phases) {
      const items: ItemView[] = []
      for (const it of ph.items) items.push(await checkItem($, tracker.root, it))
      const present = items.filter(i => i.isPresent).length
      const status = statuses.get(ph.id) ?? (present === items.length ? 'DONE' : 'OPEN')
      phases.push({ id: ph.id, title: ph.title, owner: ph.owner, status, present, total: items.length, items,
        waitsOn: ph.waitsOn ?? [], because: ph.because ?? '', state: 'waiting' })
    }
    // A phase is ready when every phase it waits on has all its files on disk; done when its own files are all there.
    const isComplete = new Map(phases.map(p => [p.id, p.present === p.total]))
    for (const p of phases) {
      p.state = isComplete.get(p.id) ? 'done' : p.waitsOn.every(id => isComplete.get(id)) ? 'ready' : 'waiting'
    }
    next = { checkedAt, phases }
  } catch (err) {
    next = { checkedAt, error: `Cannot read ${TRACKER}: ${String(err)}`, phases: [] }
  }
  await update($, view, () => next)
}

const time = (ms: number) => {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'elev8', description: 'Show the ELEV8 audit tracker (phases and files on disk)' })
    void $.ui.open({ id: PANE, title: TITLE })
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'elev8' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'ELEV8 audit tracker opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, view)
    const all = v.phases.flatMap(p => p.items)
    const have = all.filter(i => i.isPresent).length
    const ready = v.phases.filter(p => p.state === 'ready')

    return (
      <Box flexDirection="column">
        <Text bold>
          {have} of {all.length} files on disk
        </Text>
        <Text dimColor>{v.checkedAt ? `checked ${time(v.checkedAt)}, every ${REFRESH_MS / 1000} s` : 'checking...'}</Text>
        <Text color="warning">Can start now: {ready.length ? ready.map(p => p.id).join(', ') : 'nothing'}</Text>
        {v.error && <Text color="error">{v.error}</Text>}
        {v.phases.map(p => {
          const isDone = p.state === 'done'
          const isCurrent = p.state === 'ready'
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color={isDone ? 'success' : isCurrent ? 'warning' : undefined}>
                {isDone ? '✓' : isCurrent ? '▶' : '○'} {p.id} {p.title}
              </Text>
              <Text dimColor>
                {p.owner} · {p.status} · {p.present}/{p.total}
              </Text>
              {p.state === 'waiting' && <Text dimColor>waits on {p.waitsOn.join(', ')}: {p.because}</Text>}
              {p.state === 'ready' && <Text color="warning">ready: {p.because}</Text>}
              {p.items.map(i => (
                <Text color={i.isPresent ? 'success' : undefined} dimColor={!i.isPresent && !isCurrent}>
                  {'  '}
                  {i.isPresent ? '✓' : '·'} {i.label}
                  {i.isPresent ? '' : `  (${i.path})`}
                </Text>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
