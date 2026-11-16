// Lectura y validacion de archivos UF2 (formato del bootloader del nice!nano)
// Especificacion: https://github.com/microsoft/uf2

import { unzipSync } from 'fflate'

const BLOCK = 512
const MAGIC0 = 0x0a324655
const MAGIC1 = 0x9e5d5157
const MAGIC_END = 0x0ab16f30
const FLAG_FAMILY = 0x00002000
const FLAG_NOT_MAIN_FLASH = 0x00000001

const FAMILIES: Record<number, string> = {
  0xada52840: 'nRF52840',
  0x621e937a: 'nRF52833',
  0x1b57745f: 'nRF52832',
  0xe48bff56: 'RP2040',
  0xe48bff59: 'RP2350',
  0x68ed2b88: 'SAMD21',
  0x55114460: 'SAMD51',
}

export const NRF52840 = 0xada52840

export type Uf2Role = 'left' | 'right' | 'reset' | 'circuitpython' | 'unknown'

export interface Uf2Info {
  valid: boolean
  blocks: number
  familyId: number | null
  family: string
  minAddr: number
  maxAddr: number
  payload: number
  error?: string
}

export interface Uf2File {
  id: string
  name: string
  bytes: Uint8Array
  info: Uf2Info
  role: Uf2Role
  source: 'local' | 'zip' | 'bundled'
}

export function parseUf2(bytes: Uint8Array): Uf2Info {
  const bad = (error: string): Uf2Info => ({
    valid: false, blocks: 0, familyId: null, family: '?', minAddr: 0, maxAddr: 0, payload: 0, error,
  })
  if (bytes.length === 0 || bytes.length % BLOCK !== 0) return bad('El tamaño no es múltiplo de 512 bytes: no es un UF2')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = bytes.length / BLOCK
  let familyId: number | null = null
  let minAddr = Number.MAX_SAFE_INTEGER
  let maxAddr = 0
  let payload = 0
  let declared = -1

  for (let i = 0; i < count; i++) {
    const o = i * BLOCK
    if (view.getUint32(o, true) !== MAGIC0 || view.getUint32(o + 4, true) !== MAGIC1 || view.getUint32(o + 508, true) !== MAGIC_END) {
      return bad(`Bloque ${i} corrupto (firma UF2 incorrecta)`)
    }
    const flags = view.getUint32(o + 8, true)
    if (flags & FLAG_NOT_MAIN_FLASH) continue
    const addr = view.getUint32(o + 12, true)
    const size = view.getUint32(o + 16, true)
    const total = view.getUint32(o + 24, true)
    if (declared < 0) declared = total
    if (flags & FLAG_FAMILY && familyId === null) familyId = view.getUint32(o + 28, true)
    minAddr = Math.min(minAddr, addr)
    maxAddr = Math.max(maxAddr, addr + size)
    payload += size
  }

  return {
    valid: true,
    blocks: count,
    familyId,
    family: familyId === null ? 'sin familia' : (FAMILIES[familyId] ?? `0x${familyId.toString(16)}`),
    minAddr: minAddr === Number.MAX_SAFE_INTEGER ? 0 : minAddr,
    maxAddr,
    payload,
  }
}

export function roleFromName(name: string): Uf2Role {
  const n = name.toLowerCase()
  if (n.includes('settings_reset')) return 'reset'
  if (n.includes('circuitpython')) return 'circuitpython'
  if (/(^|[_\-/ ])left|_left|izq/.test(n)) return 'left'
  if (/(^|[_\-/ ])right|_right|der/.test(n)) return 'right'
  return 'unknown'
}

let n = 0
export function makeUf2(name: string, bytes: Uint8Array, source: Uf2File['source']): Uf2File {
  return { id: `uf2-${++n}`, name, bytes, info: parseUf2(bytes), role: roleFromName(name), source }
}

/** Acepta .uf2 sueltos o el firmware.zip que genera GitHub Actions */
export async function filesFromInput(list: FileList | File[]): Promise<{ files: Uf2File[]; skipped: string[] }> {
  const files: Uf2File[] = []
  const skipped: string[] = []
  for (const f of Array.from(list)) {
    const bytes = new Uint8Array(await f.arrayBuffer())
    if (f.name.toLowerCase().endsWith('.zip')) {
      try {
        const entries = unzipSync(bytes)
        for (const [path, data] of Object.entries(entries)) {
          if (path.toLowerCase().endsWith('.uf2')) files.push(makeUf2(path.split('/').pop()!, data, 'zip'))
        }
      } catch {
        skipped.push(`${f.name} (zip dañado)`)
      }
    } else if (f.name.toLowerCase().endsWith('.uf2')) {
      files.push(makeUf2(f.name, bytes, 'local'))
    } else {
      skipped.push(f.name)
    }
  }
  return { files, skipped }
}

export const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`
