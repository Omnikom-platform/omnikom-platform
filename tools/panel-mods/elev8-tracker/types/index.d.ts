export type ItemView = { label: string; path: string; isPresent: boolean }
export type PhaseView = {
  id: string
  title: string
  owner: string
  status: string
  present: number
  total: number
  items: ItemView[]
  waitsOn: string[]
  because: string
  state: 'done' | 'ready' | 'waiting'
}
export type TrackerView = { checkedAt: number; error?: string; phases: PhaseView[] }

declare module 'claude-code' {
  interface PluginState {
    'elev8-tracker': { view: TrackerView }
  }
}
