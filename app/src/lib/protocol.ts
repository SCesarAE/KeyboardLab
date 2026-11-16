// Protocolo JSON por lineas entre la app y el firmware de diagnostico.

/** Version de code.py que espera esta app */
export const EXPECTED_FW = '0.2.0'

/** a >= b para versiones x.y.z */
export function versionAtLeast(a: string | undefined, b: string) {
  if (!a) return false
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return true
}

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
  oled?: boolean
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
  | { cmd: 'oled'; op: 'init' | 'fill' | 'clear' | 'checker' | 'border' }
  | { cmd: 'oled'; op: 'frame'; b64: string; ack?: boolean }
  | { cmd: 'oled'; op: 'contrast'; v: number }
  | { cmd: 'oled'; op: 'invert' | 'flip' | 'power'; v: boolean }
  | { cmd: 'led'; mode: LedMode; rgb?: [number, number, number]; i?: number; br?: number }

/** Quita secuencias de escape de terminal (CircuitPython 10 escribe su barra de estado en la consola) */
export function cleanTerminal(line: string) {
  return line
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f]/g, '')
}

export function parseLine(line: string): DeviceMsg | null {
  const clean = cleanTerminal(line)
  const a = clean.indexOf('{')
  const b = clean.lastIndexOf('}')
  if (a < 0 || b < a) return null
  const s = clean.slice(a, b + 1)
  try {
    const obj = JSON.parse(s)
    if (obj && typeof obj.t === 'string') return obj as DeviceMsg
  } catch {
    /* linea incompleta o ruido de la consola */
  }
  return null
}
