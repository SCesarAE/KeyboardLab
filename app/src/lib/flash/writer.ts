// Escritura de archivos en la unidad del nice!nano (NICENANO) o de CircuitPython (CIRCUITPY).
//
// Orden de intentos:
//   1. showDirectoryPicker: eliges la unidad, la app verifica que sea la correcta y escribe.
//   2. showSaveFilePicker: dialogo "Guardar como"; eliges la unidad y listo.
//   3. Descarga normal: arrastras el archivo a la unidad.

export type Target = 'nicenano' | 'circuitpy'

export interface WriteResult {
  method: 'directory' | 'save' | 'download'
  status: 'ok' | 'probable' | 'cancelled' | 'error'
  detail?: string
  drive?: string
}

interface DirHandle {
  name: string
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>
}
interface FileHandleLike {
  getFile(): Promise<File>
  createWritable(opts?: { keepExistingData?: boolean }): Promise<{ write(d: BufferSource): Promise<void>; close(): Promise<void> }>
}
type PickerWindow = Window & {
  showDirectoryPicker?: (o?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirHandle>
  showSaveFilePicker?: (o?: {
    suggestedName?: string
    id?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<FileHandleLike>
}

const w = () => window as PickerWindow
export const canPickDirectory = () => typeof window !== 'undefined' && !!w().showDirectoryPicker
export const canSaveFile = () => typeof window !== 'undefined' && !!w().showSaveFilePicker

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

/** Lee el archivo de identidad de la unidad para no escribir en el disco equivocado */
async function identify(dir: DirHandle, target: Target): Promise<{ ok: boolean; info: string }> {
  const marker = target === 'nicenano' ? 'INFO_UF2.TXT' : 'boot_out.txt'
  try {
    const text = await (await (await dir.getFileHandle(marker)).getFile()).text()
    if (target === 'nicenano') {
      const model = text.match(/Model:\s*(.+)/)?.[1]?.trim()
      const board = text.match(/Board-ID:\s*(.+)/)?.[1]?.trim()
      const boot = text.split('\n')[0]?.trim()
      return { ok: true, info: [model, board, boot].filter(Boolean).join(' · ') }
    }
    return { ok: true, info: text.split('\n')[0]?.trim() ?? 'CircuitPython' }
  } catch {
    return { ok: false, info: `No encontré ${marker} en “${dir.name}”` }
  }
}

async function writeTo(handle: FileHandleLike, bytes: Uint8Array): Promise<'ok' | 'probable'> {
  const stream = await handle.createWritable({ keepExistingData: false })
  await stream.write(bytes as BufferSource)
  try {
    await stream.close()
    return 'ok'
  } catch {
    // El bootloader se reinicia en cuanto recibe el ultimo bloque y la unidad desaparece:
    // Chrome no alcanza a cerrar el archivo, pero el firmware ya quedo escrito.
    return 'probable'
  }
}

export async function writeWithDirectory(name: string, bytes: Uint8Array, target: Target): Promise<WriteResult> {
  try {
    const dir = await w().showDirectoryPicker!({ id: target, mode: 'readwrite' })
    const who = await identify(dir, target)
    if (!who.ok) {
      return {
        method: 'directory',
        status: 'error',
        detail: `${who.info}. ${target === 'nicenano' ? 'Elige la unidad NICENANO (doble tap al reset).' : 'Elige la unidad CIRCUITPY.'}`,
      }
    }
    const file = await dir.getFileHandle(name, { create: true })
    const status = await writeTo(file, bytes)
    return { method: 'directory', status, drive: who.info }
  } catch (e) {
    if (isAbort(e)) return { method: 'directory', status: 'cancelled' }
    return { method: 'directory', status: 'error', detail: e instanceof Error ? e.message : String(e) }
  }
}

export async function writeWithSave(name: string, bytes: Uint8Array): Promise<WriteResult> {
  try {
    const ext = name.split('.').pop() ?? 'uf2'
    const handle = await w().showSaveFilePicker!({
      suggestedName: name,
      id: 'firmware',
      types: [{ description: ext.toUpperCase(), accept: { 'application/octet-stream': [`.${ext}`] } }],
    })
    return { method: 'save', status: await writeTo(handle, bytes) }
  } catch (e) {
    if (isAbort(e)) return { method: 'save', status: 'cancelled' }
    return { method: 'save', status: 'error', detail: e instanceof Error ? e.message : String(e) }
  }
}

export function download(name: string, bytes: Uint8Array): WriteResult {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return { method: 'download', status: 'ok', detail: 'Arrástralo desde Descargas a la unidad' }
}

/** Intenta en orden: carpeta verificada -> guardar como -> descarga */
export async function flashFile(name: string, bytes: Uint8Array, target: Target): Promise<WriteResult> {
  if (canPickDirectory()) {
    const r = await writeWithDirectory(name, bytes, target)
    // Si Chrome bloquea la raiz de la unidad, cae al dialogo de guardar
    if (r.status !== 'error' || !/system|bloque|blocked|not allowed|security/i.test(r.detail ?? '')) return r
  }
  if (canSaveFile()) return writeWithSave(name, bytes)
  return download(name, bytes)
}
