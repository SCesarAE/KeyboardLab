// Interfaz comun para hablar con el hardware.
// Hoy: Web Serial y modo demo. Mañana: plugin de Tauri (escritorio) sin tocar la UI.

import type { DeviceMsg, HostCmd } from '../protocol'

export type DeviceStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface DeviceAdapter {
  readonly id: string
  readonly kind: 'webserial' | 'demo' | 'zmk'
  readonly label: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(cmd: HostCmd): Promise<void>
  /** Bytes crudos al puerto (p. ej. Ctrl-D para reiniciar code.py) */
  sendRaw(text: string): Promise<void>
  onMessage(cb: (msg: DeviceMsg) => void): void
  onRaw(cb: (line: string) => void): void
  onStatus(cb: (status: DeviceStatus, detail?: string) => void): void
}

let counter = 0
export const nextId = (prefix: string) => `${prefix}-${++counter}`
