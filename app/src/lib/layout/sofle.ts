// Layout fisico del Sofle (tomado de ZMK: layouts/josefadamcik/sofle.dtsi)
// Unidades: 100 = 1u. Rotacion en centesimas de grado alrededor de (rx, ry).
//
// Coordenadas "raw" del firmware de diagnostico (iguales en ambas mitades):
//   fila 0..3 = filas principales, fila 4 = pulgares (col 0..4) + tecla interior (col 5)
//   col 0 = exterior ... col 5 = interior

import type { Side } from '../protocol'

export interface KeyDef {
  id: string // `${side}:${row}:${col}`
  side: Side
  row: number
  col: number
  sw: string // etiqueta de serigrafia (SW1..SW30)
  x: number
  y: number
  w: number
  h: number
  rot: number // grados
  rx: number
  ry: number
}

type Attr = [w: number, h: number, x: number, y: number, rot: number, rx: number, ry: number]

// Las 60 teclas en el orden de ZMK
const ZMK_KEYS: Attr[] = [
  [100, 100, 0, 37, 0, 0, 0], [100, 100, 100, 37, 0, 0, 0], [100, 100, 200, 12, 0, 0, 0],
  [100, 100, 300, 0, 0, 0, 0], [100, 100, 400, 12, 0, 0, 0], [100, 100, 500, 24, 0, 0, 0],
  [100, 100, 900, 24, 0, 0, 0], [100, 100, 1000, 12, 0, 0, 0], [100, 100, 1100, 0, 0, 0, 0],
  [100, 100, 1200, 12, 0, 0, 0], [100, 100, 1300, 37, 0, 0, 0], [100, 100, 1400, 37, 0, 0, 0],
  [100, 100, 0, 137, 0, 0, 0], [100, 100, 100, 137, 0, 0, 0], [100, 100, 200, 112, 0, 0, 0],
  [100, 100, 300, 100, 0, 0, 0], [100, 100, 400, 112, 0, 0, 0], [100, 100, 500, 124, 0, 0, 0],
  [100, 100, 900, 124, 0, 0, 0], [100, 100, 1000, 112, 0, 0, 0], [100, 100, 1100, 100, 0, 0, 0],
  [100, 100, 1200, 112, 0, 0, 0], [100, 100, 1300, 137, 0, 0, 0], [100, 100, 1400, 137, 0, 0, 0],
  [100, 100, 0, 237, 0, 0, 0], [100, 100, 100, 237, 0, 0, 0], [100, 100, 200, 212, 0, 0, 0],
  [100, 100, 300, 200, 0, 0, 0], [100, 100, 400, 212, 0, 0, 0], [100, 100, 500, 224, 0, 0, 0],
  [100, 100, 900, 224, 0, 0, 0], [100, 100, 1000, 212, 0, 0, 0], [100, 100, 1100, 200, 0, 0, 0],
  [100, 100, 1200, 212, 0, 0, 0], [100, 100, 1300, 237, 0, 0, 0], [100, 100, 1400, 237, 0, 0, 0],
  [100, 100, 0, 337, 0, 0, 0], [100, 100, 100, 337, 0, 0, 0], [100, 100, 200, 312, 0, 0, 0],
  [100, 100, 300, 300, 0, 0, 0], [100, 100, 400, 312, 0, 0, 0], [100, 100, 500, 324, 0, 0, 0],
  [100, 100, 600, 274, 0, 0, 0], [100, 100, 800, 274, 0, 0, 0],
  [100, 100, 900, 324, 0, 0, 0], [100, 100, 1000, 312, 0, 0, 0], [100, 100, 1100, 300, 0, 0, 0],
  [100, 100, 1200, 312, 0, 0, 0], [100, 100, 1300, 337, 0, 0, 0], [100, 100, 1400, 337, 0, 0, 0],
  [100, 100, 175, 437, 0, 0, 0], [100, 100, 275, 412, 0, 0, 0], [100, 100, 375, 412, 0, 0, 0],
  [100, 100, 490, 412, 1200, 490, 412], [100, 150, 600, 383, 2400, 600, 433],
  [100, 150, 800, 383, -2400, 900, 433], [100, 100, 910, 412, -1200, 1010, 412],
  [100, 100, 1025, 412, 0, 0, 0], [100, 100, 1125, 412, 0, 0, 0], [100, 100, 1225, 437, 0, 0, 0],
]

// Indice ZMK -> [lado, fila raw, columna raw]
function rawFor(index: number): [Side, number, number] {
  // filas 0..2 (12 teclas cada una)
  if (index < 36) {
    const row = Math.floor(index / 12)
    const k = index % 12
    return k < 6 ? ['left', row, k] : ['right', row, 5 - (k - 6)]
  }
  // fila 3 + teclas interiores (14 teclas)
  if (index < 50) {
    const k = index - 36
    if (k < 6) return ['left', 3, k]
    if (k === 6) return ['left', 4, 5]
    if (k === 7) return ['right', 4, 5]
    return ['right', 3, 5 - (k - 8)]
  }
  // pulgares (10 teclas)
  const k = index - 50
  return k < 5 ? ['left', 4, k] : ['right', 4, 4 - (k - 5)]
}

function swLabel(row: number, col: number): string {
  if (row < 4) return `SW${(row + 1) * 6 - col}`
  return col === 5 ? 'SW25' : `SW${30 - col}`
}

export const KEYS: KeyDef[] = ZMK_KEYS.map((a, i) => {
  const [side, row, col] = rawFor(i)
  const [w, h, x, y, rot, rx, ry] = a
  return { id: `${side}:${row}:${col}`, side, row, col, sw: swLabel(row, col), x, y, w, h, rot: rot / 100, rx, ry }
})

export const KEY_BY_ID: Record<string, KeyDef> = Object.fromEntries(KEYS.map((k) => [k.id, k]))

export const keyId = (side: Side, row: number, col: number) => `${side}:${row}:${col}`

export const ROWS = 5
export const COLS = 6
export const ROW_PINS = ['D5', 'D6', 'D7', 'D8', 'D9']
export const COL_PINS = ['D19', 'D18', 'D15', 'D14', 'D16', 'D10']

// Orden de la cadena de LEDs (Sofle Choc, QMK rgb_matrix), en coordenadas raw.
// 29 LEDs por lado: la tecla interior (fila 4, col 5) no tiene LED.
export const LED_ORDER: [number, number][] = [
  [0, 5], [1, 5], [2, 5], [3, 5], [4, 4], [4, 3], [4, 2], [3, 4], [2, 4], [1, 4],
  [0, 4], [0, 3], [1, 3], [2, 3], [3, 3], [4, 1], [4, 0], [3, 2], [2, 2], [1, 2],
  [0, 2], [0, 1], [1, 1], [2, 1], [3, 1], [3, 0], [2, 0], [1, 0], [0, 0],
]

// Posicion aproximada del encoder y del controlador/OLED (unidades de layout)
export const EXTRAS: Record<Side, { encoder: [number, number]; controller: [number, number] }> = {
  left: { encoder: [655, 222], controller: [655, 88] },
  right: { encoder: [845, 222], controller: [845, 88] },
}

// Mapeo del teclado de la PC para el modo demo (QWERTY)
export const DEMO_KEYMAP: Record<string, string> = {}
const leftRows = [
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'],
  ['Tab', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'],
  ['CapsLock', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'],
  ['ShiftLeft', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'],
  ['ControlLeft', 'MetaLeft', 'AltLeft', 'Escape', 'Space', 'F1'],
]
const rightRows = [
  ['Minus', 'Digit0', 'Digit9', 'Digit8', 'Digit7', 'Digit6'],
  ['BracketLeft', 'KeyP', 'KeyO', 'KeyI', 'KeyU', 'KeyY'],
  ['Quote', 'Semicolon', 'KeyL', 'KeyK', 'KeyJ', 'KeyH'],
  ['ShiftRight', 'Slash', 'Period', 'Comma', 'KeyM', 'KeyN'],
  ['ControlRight', 'AltRight', 'Backspace', 'Delete', 'Enter', 'F2'],
]
leftRows.forEach((r, row) => r.forEach((code, col) => (DEMO_KEYMAP[code] = keyId('left', row, col))))
rightRows.forEach((r, row) => r.forEach((code, col) => (DEMO_KEYMAP[code] = keyId('right', row, col))))

// ---------------------------------------------------------------------------
// Prueba con ZMK: keymap por defecto del shield sofle de ZMK (capa 0).
// e.code es la posicion fisica (independiente del idioma del teclado en Windows).
// ---------------------------------------------------------------------------
export const ZMK_KEYMAP: Record<string, string> = {}
const zl = [
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'],
  ['Escape', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'],
  ['Tab', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'],
  ['ShiftLeft', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'],
  ['MetaLeft', 'AltLeft', 'ControlLeft', '', 'Enter', 'AudioVolumeMute'],
]
// derecha en coordenadas raw: col 0 = exterior ... col 5 = interior
const zr = [
  ['', 'Digit0', 'Digit9', 'Digit8', 'Digit7', 'Digit6'],
  ['Backspace', 'KeyP', 'KeyO', 'KeyI', 'KeyU', 'KeyY'],
  ['Quote', 'Semicolon', 'KeyL', 'KeyK', 'KeyJ', 'KeyH'],
  ['ShiftRight', 'Slash', 'Period', 'Comma', 'KeyM', 'KeyN'],
  ['MetaRight', 'AltRight', 'ControlRight', '', 'Space', ''],
]
zl.forEach((r, row) => r.forEach((code, col) => code && (ZMK_KEYMAP[code] = keyId('left', row, col))))
zr.forEach((r, row) => r.forEach((code, col) => code && (ZMK_KEYMAP[code] = keyId('right', row, col))))

/** Teclas que en la capa 0 no envian nada a la PC (&none o cambio de capa): no se pueden verificar con ZMK */
export const ZMK_UNTESTABLE = new Set([
  keyId('left', 4, 3), // LOWER
  keyId('right', 4, 3), // RAISE
  keyId('right', 0, 0), // &none
  keyId('right', 4, 5), // &none
])

/** Encoders en ZMK: izquierda = volumen, derecha = Re Pag / Av Pag */
export const ZMK_ENCODERS: Record<string, ['left' | 'right', 1 | -1]> = {
  AudioVolumeUp: ['left', 1],
  AudioVolumeDown: ['left', -1],
  PageDown: ['right', 1],
  PageUp: ['right', -1],
}
