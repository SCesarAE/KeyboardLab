import { create } from 'zustand'
import type { DeviceMsg, HostCmd, Side, SideOrUnknown } from './protocol'
import type { DeviceAdapter, DeviceStatus } from './device/types'
import { keyId } from './layout/sofle'

export interface DeviceState {
  id: string
  kind: DeviceAdapter['kind']
  label: string
  status: DeviceStatus
  detail?: string
  side: SideOrUnknown
  fw?: string
  version?: string
  leds: number
  enc: boolean
  lastSeen: number
}

export interface KeyStat {
  pressed: boolean
  count: number
  bounces: number
  downAt: number // performance.now() de la ultima pulsacion
  lastUpMs: number // reloj del dispositivo en la ultima liberacion
}

export interface EncoderStat {
  pos: number
  cw: number
  ccw: number
  lastAt: number
  lastDir: 1 | -1 | 0
}

export interface LogEntry {
  id: number
  at: number
  level: 'info' | 'ok' | 'warn' | 'error' | 'raw'
  text: string
}

export interface LedPreview {
  side: Side | 'both'
  index: number | null // null = todos
  rgb: [number, number, number]
  mode: 'off' | 'all' | 'one' | 'chase' | 'rainbow'
}

interface State {
  devices: Record<string, DeviceState>
  keys: Record<string, KeyStat>
  encoders: Record<Side, EncoderStat>
  log: LogEntry[]
  led: LedPreview
  demoMode: boolean
  hovered: string | null
  setHovered: (id: string | null) => void
  addLog: (level: LogEntry['level'], text: string) => void
  attach: (adapter: DeviceAdapter) => Promise<void>
  detach: (id: string) => Promise<void>
  setSide: (id: string, side: Side) => Promise<void>
  sendTo: (side: Side | 'both', cmd: HostCmd) => Promise<void>
  setLed: (led: Partial<LedPreview>) => void
  resetTests: (side?: Side) => void
  setDemoMode: (on: boolean) => void
}

// Los adaptadores no son serializables: viven fuera del estado
export const adapters = new Map<string, DeviceAdapter>()

const BOUNCE_MS = 30
const emptyEncoder = (): EncoderStat => ({ pos: 0, cw: 0, ccw: 0, lastAt: 0, lastDir: 0 })
let logId = 0

export const useLab = create<State>((set, get) => ({
  devices: {},
  keys: {},
  encoders: { left: emptyEncoder(), right: emptyEncoder() },
  log: [],
  led: { side: 'both', index: null, rgb: [0, 255, 255], mode: 'off' },
  demoMode: false,
  hovered: null,
  setHovered: (id) => set({ hovered: id }),

  addLog: (level, text) =>
    set((s) => ({ log: [...s.log.slice(-299), { id: ++logId, at: Date.now(), level, text }] })),

  attach: async (adapter) => {
    const { addLog } = get()
    adapters.set(adapter.id, adapter)
    set((s) => ({
      devices: {
        ...s.devices,
        [adapter.id]: {
          id: adapter.id, kind: adapter.kind, label: adapter.label, status: 'connecting',
          side: 'unknown', leds: 29, enc: false, lastSeen: Date.now(),
        },
      },
    }))

    adapter.onStatus((status, detail) => {
      set((s) => {
        const d = s.devices[adapter.id]
        if (!d) return s
        return { devices: { ...s.devices, [adapter.id]: { ...d, status, detail, label: adapter.label } } }
      })
      if (status === 'connected') addLog('ok', `${adapter.label} conectado`)
      if (status === 'disconnected') addLog('warn', `${adapter.label} desconectado${detail ? ': ' + detail : ''}`)
      if (status === 'error') addLog('error', `${adapter.label}: ${detail ?? 'error'}`)
    })
    adapter.onRaw((line) => addLog('raw', line))
    adapter.onMessage((msg) => handleMessage(adapter.id, msg))

    try {
      await adapter.connect()
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      addLog(text.includes('No port selected') ? 'warn' : 'error', `No se pudo conectar: ${text}`)
      adapters.delete(adapter.id)
      set((s) => {
        const devices = { ...s.devices }
        delete devices[adapter.id]
        return { devices }
      })
    }
  },

  detach: async (id) => {
    const a = adapters.get(id)
    if (a) await a.disconnect()
    adapters.delete(id)
    set((s) => {
      const devices = { ...s.devices }
      delete devices[id]
      return { devices }
    })
  },

  setSide: async (id, side) => {
    const a = adapters.get(id)
    await a?.send({ cmd: 'side', v: side })
    set((s) => ({ devices: { ...s.devices, [id]: { ...s.devices[id], side } } }))
    get().addLog('info', `Mitad asignada: ${side === 'left' ? 'izquierda' : 'derecha'}`)
  },

  sendTo: async (side, cmd) => {
    const targets = Object.values(get().devices).filter(
      (d) => d.status === 'connected' && (side === 'both' || d.side === side),
    )
    await Promise.all(targets.map((d) => adapters.get(d.id)?.send(cmd)))
  },

  setLed: (led) => set((s) => ({ led: { ...s.led, ...led } })),

  resetTests: (side) =>
    set((s) => {
      const keys = { ...s.keys }
      for (const k of Object.keys(keys)) if (!side || k.startsWith(side)) delete keys[k]
      const encoders = { ...s.encoders }
      if (!side || side === 'left') encoders.left = emptyEncoder()
      if (!side || side === 'right') encoders.right = emptyEncoder()
      return { keys, encoders }
    }),

  setDemoMode: (on) => set({ demoMode: on }),
}))

function handleMessage(deviceId: string, msg: DeviceMsg) {
  const { devices, addLog } = useLab.getState()
  const dev = devices[deviceId]
  if (!dev) return
  const touch = (patch: Partial<DeviceState> = {}) =>
    useLab.setState((s) => ({
      devices: { ...s.devices, [deviceId]: { ...s.devices[deviceId], lastSeen: Date.now(), ...patch } },
    }))

  switch (msg.t) {
    case 'hello':
      touch({ fw: msg.fw, version: msg.v, side: msg.side, leds: msg.leds, enc: msg.enc })
      addLog('ok', `Firmware ${msg.fw} v${msg.v} · lado: ${sideName(msg.side)} · ${msg.leds} LEDs`)
      break
    case 'hb':
      touch()
      break
    case 'ack':
      touch()
      break
    case 'err':
      addLog('error', `Dispositivo: ${msg.msg}`)
      break
    case 'enc': {
      touch()
      if (dev.side === 'unknown') return
      const side = dev.side
      // En la mitad derecha los pines A/B estan invertidos respecto a la izquierda
      const dir = (side === 'right' ? -msg.d : msg.d) as 1 | -1
      useLab.setState((s) => {
        const e = s.encoders[side]
        return {
          encoders: {
            ...s.encoders,
            [side]: {
              pos: e.pos + dir, cw: e.cw + (dir > 0 ? 1 : 0), ccw: e.ccw + (dir < 0 ? 1 : 0),
              lastAt: performance.now(), lastDir: dir,
            },
          },
        }
      })
      break
    }
    case 'key': {
      touch()
      if (dev.side === 'unknown') {
        addLog('warn', `Tecla r${msg.r} c${msg.c}: asigna primero el lado de esta mitad`)
        return
      }
      const id = keyId(dev.side, msg.r, msg.c)
      useLab.setState((s) => {
        const prev = s.keys[id] ?? { pressed: false, count: 0, bounces: 0, downAt: 0, lastUpMs: -1e9 }
        const next: KeyStat = msg.p
          ? {
              ...prev,
              pressed: true,
              count: prev.count + 1,
              downAt: performance.now(),
              bounces: prev.bounces + (msg.ms - prev.lastUpMs < BOUNCE_MS ? 1 : 0),
            }
          : { ...prev, pressed: false, lastUpMs: msg.ms }
        return { keys: { ...s.keys, [id]: next } }
      })
      break
    }
  }
}

export const sideName = (s: SideOrUnknown) =>
  s === 'left' ? 'izquierda' : s === 'right' ? 'derecha' : 'sin asignar'
