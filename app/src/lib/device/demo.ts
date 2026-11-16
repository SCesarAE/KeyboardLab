import type { DeviceMsg, HostCmd, Side } from '../protocol'
import { nextId, type DeviceAdapter, type DeviceStatus } from './types'

// Dispositivo simulado: permite probar la app sin hardware.
// Las pulsaciones llegan desde el teclado de la PC o haciendo clic en el modelo 3D.
export class DemoAdapter implements DeviceAdapter {
  readonly id = nextId('demo')
  readonly kind = 'demo' as const
  readonly label: string
  private msgCbs: ((m: DeviceMsg) => void)[] = []
  private statusCbs: ((s: DeviceStatus, d?: string) => void)[] = []
  readonly side: Side
  private encPos = 0
  private t0 = performance.now()

  constructor(side: Side) {
    this.side = side
    this.label = `Demo (${side === 'left' ? 'izquierda' : 'derecha'})`
  }

  onMessage(cb: (m: DeviceMsg) => void) {
    this.msgCbs.push(cb)
  }
  onRaw() {}
  onStatus(cb: (s: DeviceStatus, d?: string) => void) {
    this.statusCbs.push(cb)
  }

  private emit(m: DeviceMsg) {
    this.msgCbs.forEach((cb) => cb(m))
  }

  async connect() {
    this.statusCbs.forEach((cb) => cb('connected'))
    this.hello()
  }

  async disconnect() {
    this.statusCbs.forEach((cb) => cb('disconnected'))
  }

  private hello() {
    this.emit({
      t: 'hello', fw: 'keyboardlab-diag', v: 'demo', board: 'simulado', side: this.side,
      rows: 5, cols: 6, rowPins: ['D5', 'D6', 'D7', 'D8', 'D9'],
      colPins: ['D19', 'D18', 'D15', 'D14', 'D16', 'D10'], enc: true, leds: 29, maxBr: 0.35,
    })
  }

  async send(cmd: HostCmd) {
    if (cmd.cmd === 'hello') this.hello()
    else this.emit({ t: 'ack', cmd: cmd.cmd })
  }

  key(row: number, col: number, pressed: boolean) {
    this.emit({ t: 'key', r: row, c: col, p: pressed ? 1 : 0, ms: Math.round(performance.now() - this.t0) })
  }

  turn(dir: 1 | -1) {
    this.encPos += dir
    this.emit({ t: 'enc', d: dir, pos: this.encPos })
  }
}
