import { parseLine, type DeviceMsg, type HostCmd } from '../protocol'
import { nextId, type DeviceAdapter, type DeviceStatus } from './types'

// VID de Adafruit: lo usan CircuitPython y el bootloader del nice!nano
const FILTERS: SerialPortFilter[] = [{ usbVendorId: 0x239a }]

/** Puertos abiertos por esta pestaña (para no abrir dos veces el mismo) */
const openPorts = new Set<SerialPort>()

export const isPortOpen = (p: SerialPort) => openPorts.has(p)

export async function grantedPorts() {
  if (!webSerialSupported()) return []
  const ports = await navigator.serial.getPorts()
  return ports.filter((p) => p.getInfo().usbVendorId === 0x239a)
}

export const webSerialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator

export class WebSerialAdapter implements DeviceAdapter {
  readonly id = nextId('serial')
  readonly kind = 'webserial' as const
  label = 'Puerto serie'

  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<string> | null = null
  private readLoop: Promise<void> | null = null
  private closing = false
  private preset: SerialPort | null

  /** Si se pasa un puerto ya autorizado, no se abre el selector de Chrome */
  constructor(port?: SerialPort) {
    this.preset = port ?? null
  }
  private msgCbs: ((m: DeviceMsg) => void)[] = []
  private rawCbs: ((l: string) => void)[] = []
  private statusCbs: ((s: DeviceStatus, d?: string) => void)[] = []

  onMessage(cb: (m: DeviceMsg) => void) {
    this.msgCbs.push(cb)
  }
  onRaw(cb: (l: string) => void) {
    this.rawCbs.push(cb)
  }
  onStatus(cb: (s: DeviceStatus, d?: string) => void) {
    this.statusCbs.push(cb)
  }

  private emitStatus(s: DeviceStatus, d?: string) {
    this.statusCbs.forEach((cb) => cb(s, d))
  }

  async connect() {
    this.emitStatus('connecting')
    // requestPort debe llamarse desde un clic del usuario (requisito de Chrome)
    const port = this.preset ?? (await navigator.serial.requestPort({ filters: FILTERS }))
    if (openPorts.has(port)) {
      throw new Error('Ese puerto ya está conectado. En la lista elige el otro nice!nano (el que no dice "conectado").')
    }
    const info = port.getInfo()
    this.label = `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)}`
    await port.open({ baudRate: 115200 })
    openPorts.add(port)
    this.port = port
    this.closing = false
    navigator.serial.addEventListener('disconnect', this.handleUnplug)
    this.readLoop = this.read()
    this.emitStatus('connected')
    // Pide el saludo por si code.py ya estaba corriendo
    await this.send({ cmd: 'hello' })
  }

  private handleUnplug = (e: Event) => {
    if ((e.target as SerialPort) === this.port) {
      this.emitStatus('disconnected', 'Cable desconectado')
      void this.disconnect()
    }
  }

  private async read() {
    if (!this.port?.readable) return
    const decoder = new TextDecoderStream()
    const done = this.port.readable.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => {})
    this.reader = decoder.readable.getReader()
    let buffer = ''
    try {
      for (;;) {
        const { value, done: finished } = await this.reader.read()
        if (finished) break
        buffer += value
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).replace(/\r$/, '')
          buffer = buffer.slice(nl + 1)
          if (!line.trim()) continue
          const msg = parseLine(line)
          if (msg) this.msgCbs.forEach((cb) => cb(msg))
          else this.rawCbs.forEach((cb) => cb(line))
        }
        if (buffer.length > 4096) buffer = ''
      }
    } catch (err) {
      if (!this.closing) this.emitStatus('error', String(err))
    } finally {
      this.reader?.releaseLock()
      await done
    }
  }

  async send(cmd: HostCmd) {
    if (!this.port?.writable) return
    const writer = this.port.writable.getWriter()
    try {
      await writer.write(new TextEncoder().encode(JSON.stringify(cmd) + '\n'))
    } finally {
      writer.releaseLock()
    }
  }

  async disconnect() {
    if (!this.port) return
    this.closing = true
    navigator.serial.removeEventListener('disconnect', this.handleUnplug)
    try {
      await this.reader?.cancel()
      await this.readLoop
      await this.port.close()
    } catch {
      /* el puerto ya no existe */
    }
    openPorts.delete(this.port)
    this.port = null
    this.emitStatus('disconnected')
  }
}

const hex = (n?: number) => (n ?? 0).toString(16).padStart(4, '0')
