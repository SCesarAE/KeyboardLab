// Protocolo JSON por lineas entre la app y el firmware de diagnostico.

/** Version de code.py que espera esta app */
export const EXPECTED_FW = '0.1.2'

export type Side = 'left' | 'right'
export type SideOrUnknown = Side | 'unknown'

export interface HelloMsg {
  t: 'hello'
  fw: string
  v: string
  board: string
  side: SideOrUnknown
  rows: number
  cols: number
  rowPins: string[]
  colPins: string[]
  enc: boolean
  leds: number
  maxBr: number
  vcc?: boolean
}

export interface KeyMsg {
  t: 'key'
  r: number
  c: number
  p: 0 | 1
  ms: number
}

export interface EncMsg {
  t: 'enc'
  d: 1 | -1
  pos: number
}

export interface HeartbeatMsg {
  t: 'hb'
  up: number
}

export interface AckMsg {
  t: 'ack'
  cmd: string
  [k: string]: unknown
}

export interface ErrMsg {
  t: 'err'
  msg: string
}

export type DeviceMsg = HelloMsg | KeyMsg | EncMsg | HeartbeatMsg | AckMsg | ErrMsg

export type LedMode = 'off' | 'all' | 'one' | 'chase' | 'rainbow'

export type HostCmd =
  | { cmd: 'hello' }
  | { cmd: 'ping' }
  | { cmd: 'side'; v: Side }
  | { cmd: 'leds'; n: number }
  | { cmd: 'vcc'; on: boolean }
  | { cmd: 'bootloader' }
  | { cmd: 'led'; mode: LedMode; rgb?: [number, number, number]; i?: number; br?: number }

export function parseLine(line: string): DeviceMsg | null {
  const s = line.trim()
  if (!s.startsWith('{')) return null
  try {
    const obj = JSON.parse(s)
    if (obj && typeof obj.t === 'string') return obj as DeviceMsg
  } catch {
    /* linea incompleta o ruido de la consola */
  }
  return null
}
