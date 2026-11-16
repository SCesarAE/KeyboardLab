import type { Side } from './protocol'
import type { KeyStat } from './store'
import { COL_PINS, COLS, KEYS, ROW_PINS, ROWS, keyId } from './layout/sofle'

export interface Issue {
  level: 'error' | 'warn' | 'info'
  title: string
  detail: string
  keyIds: string[]
}

export interface SideReport {
  side: Side
  tested: number
  total: number
  untested: string[]
}

const NICE_PIN: Record<string, string> = {
  D5: 'P0.24', D6: 'P1.00', D7: 'P0.11', D8: 'P1.04', D9: 'P1.06',
  D19: 'P0.02', D18: 'P1.15', D15: 'P1.13', D14: 'P1.11', D16: 'P0.10', D10: 'P0.09',
}

const STUCK_MS = 4000
const sideEs = (s: Side) => (s === 'left' ? 'izquierda' : 'derecha')

export function diagnose(keys: Record<string, KeyStat>, sides: Side[], now: number, exclude: Set<string> = new Set()) {
  const reports: SideReport[] = []
  const issues: Issue[] = []

  for (const side of sides) {
    const sideKeys = KEYS.filter((k) => k.side === side && !exclude.has(k.id))
    const tested = sideKeys.filter((k) => (keys[k.id]?.count ?? 0) > 0)
    const untested = sideKeys.filter((k) => !keys[k.id]?.count).map((k) => k.id)
    reports.push({ side, tested: tested.length, total: sideKeys.length, untested })

    // Filas o columnas completas muertas: apuntan a un pin o al header, no a un switch
    // Solo se reporta cuando ya hay suficiente avance, para no alarmar a mitad de la prueba
    if (tested.length >= 15) {
      const level: Issue['level'] = tested.length >= 24 ? 'error' : 'warn'
      for (let r = 0; r < ROWS; r++) {
        const row = sideKeys.filter((k) => k.row === r)
        if (row.every((k) => !keys[k.id]?.count)) {
          const pin = ROW_PINS[r]
          issues.push({
            level,
            title: `Fila ${r} completa sin respuesta (${sideEs(side)})`,
            detail: `Revisa la soldadura del pin ${pin} (${NICE_PIN[pin]}) en el header del nice!nano y la pista de esa fila.`,
            keyIds: row.map((k) => k.id),
          })
        }
      }
      for (let c = 0; c < COLS; c++) {
        const col = sideKeys.filter((k) => k.col === c)
        if (col.every((k) => !keys[k.id]?.count)) {
          const pin = COL_PINS[c]
          issues.push({
            level,
            title: `Columna ${c} completa sin respuesta (${sideEs(side)})`,
            detail: `Revisa la soldadura del pin ${pin} (${NICE_PIN[pin]}) en el header del nice!nano.`,
            keyIds: col.map((k) => k.id),
          })
        }
      }
    }

    // Teclas sueltas que faltan cuando ya casi todo esta probado
    if (tested.length >= sideKeys.length * 0.8 && untested.length > 0) {
      const names = untested.map((id) => labelOf(id)).join(', ')
      issues.push({
        level: 'warn',
        title: `${untested.length} tecla(s) sin registrar en la mitad ${sideEs(side)}`,
        detail: `${names}. Revisa los 2 pads del switch o socket y el diodo de cada una (orientacion y soldadura).`,
        keyIds: untested,
      })
    }
  }

  for (const [id, k] of Object.entries(keys)) {
    if (k.pressed && now - k.downAt > STUCK_MS) {
      issues.push({
        level: 'error',
        title: `${labelOf(id)} sigue presionada`,
        detail: 'Si no la estás presionando: switch atascado, puente de estaño o corto entre pads.',
        keyIds: [id],
      })
    }
    if (k.bounces >= 2) {
      issues.push({
        level: 'warn',
        title: `${labelOf(id)} rebota (${k.bounces} veces)`,
        detail: 'Doble registro en menos de 30 ms: típico de una soldadura fría o un switch mal asentado.',
        keyIds: [id],
      })
    }
  }

  return { reports, issues }
}

export function labelOf(id: string) {
  const [side, r, c] = id.split(':')
  const k = KEYS.find((x) => x.id === keyId(side as Side, Number(r), Number(c)))
  return k ? `${k.sw} ${side === 'left' ? 'izq' : 'der'} (f${r} c${c})` : id
}
