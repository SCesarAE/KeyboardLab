import { useEffect, useRef, useState } from 'react'
import type { Side } from '../lib/protocol'
import { useLab } from '../lib/store'
import { useFlash, type Recipe } from '../lib/flash/store'
import { NRF52840, filesFromInput, kb, makeUf2, type Uf2File, type Uf2Role } from '../lib/flash/uf2'
import { canPickDirectory, canSaveFile, flashFile, type Target, type WriteResult } from '../lib/flash/writer'

const BASE = import.meta.env.BASE_URL
const ZMK_ACTIONS = 'https://github.com/SCesarAE/zmk-config/actions'
const CP_PAGE = 'https://circuitpython.org/board/nice_nano/'

const ROLE_LABEL: Record<Uf2Role, string> = {
  left: 'ZMK izquierda',
  right: 'ZMK derecha',
  reset: 'settings_reset',
  circuitpython: 'CircuitPython',
  unknown: 'sin identificar',
}

const sideEs = (s: Side) => (s === 'left' ? 'izquierda' : 'derecha')

// ---------------------------------------------------------------------------
// Pasos de cada receta
// ---------------------------------------------------------------------------
type StepDef =
  | { kind: 'boot'; title: string; hint: string }
  | { kind: 'manual'; title: string; hint: string; cta: string }
  | { kind: 'write'; title: string; hint: string; role: Uf2Role | 'codepy'; target: Target }
  | { kind: 'done'; title: string; hint: string }

function stepsFor(recipe: Recipe, side: Side): StepDef[] {
  if (recipe === 'zmk') {
    return [
      { kind: 'boot', title: 'Entrar al bootloader', hint: 'Debe aparecer la unidad NICENANO.' },
      { kind: 'write', title: 'Escribir settings_reset', hint: 'Borra emparejamientos y datos viejos (incluido CircuitPython).', role: 'reset', target: 'nicenano' },
      { kind: 'manual', title: 'Doble tap otra vez', hint: 'settings_reset no tiene USB: dale doble tap rápido hasta ver NICENANO.', cta: 'Ya veo NICENANO' },
      { kind: 'write', title: `Escribir ZMK ${sideEs(side)}`, hint: 'Al terminar, la placa reinicia con ZMK.', role: side, target: 'nicenano' },
      {
        kind: 'done',
        title: 'Listo',
        hint: side === 'left' ? 'Busca “Sofle” en Bluetooth de Windows y emparéjalo.' : 'Enciéndela junto a la izquierda: se enlazan solas.',
      },
    ]
  }
  return [
    { kind: 'boot', title: 'Entrar al bootloader', hint: 'Debe aparecer la unidad NICENANO.' },
    { kind: 'write', title: 'Escribir CircuitPython', hint: 'Instala el intérprete en el nice!nano.', role: 'circuitpython', target: 'nicenano' },
    { kind: 'manual', title: 'Esperar CIRCUITPY', hint: 'La placa reinicia y monta la unidad CIRCUITPY (unos 5 s).', cta: 'Ya aparece CIRCUITPY' },
    { kind: 'write', title: 'Copiar code.py', hint: 'Firmware de diagnóstico de KeyboardLab.', role: 'codepy', target: 'circuitpy' },
    { kind: 'done', title: 'Listo', hint: 'Ve a la pestaña Diagnóstico y conecta esta mitad.' },
  ]
}

// ---------------------------------------------------------------------------
export default function FlashView() {
  const { recipe, setRecipe, files, addFiles, setCodePy, codePy } = useFlash()
  const addLog = useLab((s) => s.addLog)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  // Archivos incluidos en la app: code.py y, si el build lo descargo, CircuitPython
  useEffect(() => {
    if (!codePy) {
      fetch(`${BASE}firmware/code.py`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
        .then((b) => {
          const bytes = new Uint8Array(b)
          if (new TextDecoder().decode(bytes.slice(0, 40)).includes('KeyboardLab')) setCodePy(bytes)
          else return Promise.reject()
        })
        .catch(() => addLog('warn', 'No pude cargar code.py incluido en la app'))
    }
    if (!files.some((f) => f.role === 'circuitpython')) {
      fetch(`${BASE}firmware/circuitpython-nice_nano.uf2`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
        .then((b) => {
          const name = 'circuitpython-nice_nano.uf2'
          const file = makeUf2(name, new Uint8Array(b), 'bundled')
          // Algunos servidores devuelven la pagina HTML en lugar de un 404: solo se agrega si es un UF2 valido
          if (file.info.valid && !useFlash.getState().files.some((f) => f.name === name)) addFiles([file])
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ingest = async (list: FileList | File[]) => {
    const { files: got, skipped } = await filesFromInput(list)
    if (got.length) addFiles(got)
    got.forEach((f) => addLog(f.info.valid ? 'ok' : 'error', `Firmware cargado: ${f.name} · ${f.info.valid ? `${f.info.family}, ${kb(f.bytes.length)}` : f.info.error}`))
    if (skipped.length) addLog('warn', `Ignorados (no son .uf2 ni .zip): ${skipped.join(', ')}`)
  }

  const method = canPickDirectory() ? 'Eliges la unidad y la app verifica que sea la correcta' : canSaveFile() ? 'Diálogo “Guardar como”: elige la unidad' : 'Descarga y arrastra a la unidad'

  return (
    <section className="flash panel">
      <header className="flash-head">
        <div>
          <h3>Flash asistido</h3>
          <p className="muted">Método de escritura: {method}.</p>
        </div>
        <div className="row wrap">
          {([
            ['zmk', 'ZMK limpio'],
            ['diag', 'Volver al diagnóstico'],
            ['single', 'Archivo suelto'],
          ] as [Recipe, string][]).map(([id, label]) => (
            <button key={id} className={`btn tiny ${recipe === id ? 'on' : ''}`} onClick={() => setRecipe(id)}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <div
        className={`drop ${drag ? 'over' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void ingest(e.dataTransfer.files)
        }}
        onClick={() => input.current?.click()}
      >
        <input
          ref={input}
          type="file"
          accept=".uf2,.zip"
          multiple
          hidden
          onChange={(e) => e.target.files && void ingest(e.target.files)}
        />
        <b>Suelta aquí tus .uf2 o el firmware.zip</b>
        <span>
          El zip de{' '}
          <a href={ZMK_ACTIONS} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            tu zmk-config (Actions)
          </a>{' '}
          trae izquierda, derecha y settings_reset.
        </span>
      </div>

      <FileTable />

      {recipe === 'single' ? (
        <SingleFlash />
      ) : (
        <div className="flash-sides">
          <SidePlan side="left" />
          <SidePlan side="right" />
        </div>
      )}
      {recipe === 'diag' && !files.some((f) => f.role === 'circuitpython') && (
        <p className="notice">
          Falta el .uf2 de CircuitPython: descárgalo de{' '}
          <a href={CP_PAGE} target="_blank" rel="noreferrer">circuitpython.org</a> y suéltalo arriba.
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
function FileTable() {
  const { files, removeFile, setRole } = useFlash()
  if (!files.length) return <p className="muted">Aún no hay archivos de firmware cargados.</p>
  return (
    <table className="files">
      <tbody>
        {files.map((f) => (
          <tr key={f.id} className={f.info.valid ? '' : 'bad'}>
            <td className="fname" title={f.name}>
              {f.name}
              {f.source === 'bundled' && <em> · incluido</em>}
            </td>
            <td>
              <select value={f.role} onChange={(e) => setRole(f.id, e.target.value as Uf2Role)}>
                {(Object.keys(ROLE_LABEL) as Uf2Role[]).map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </td>
            <td>{kb(f.bytes.length)}</td>
            <td>
              {!f.info.valid ? (
                <span className="err">✕ {f.info.error}</span>
              ) : f.info.familyId !== null && f.info.familyId !== NRF52840 ? (
                <span className="err">⚠ {f.info.family}: no es para nRF52840</span>
              ) : (
                <span className="okc">✓ {f.info.family} · {f.info.blocks} bloques</span>
              )}
            </td>
            <td>
              <button className="btn tiny ghost" onClick={() => removeFile(f.id)}>✕</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
function pick(files: Uf2File[], role: Uf2Role) {
  return files.find((f) => f.role === role && f.info.valid)
}

function describe(r?: WriteResult) {
  if (!r) return null
  if (r.status === 'ok') return `✓ Escrito${r.drive ? ` en ${r.drive}` : ''}`
  if (r.status === 'probable') return '✓ Escrito: la placa se reinició al terminar (normal)'
  if (r.status === 'cancelled') return 'Cancelado'
  return `✕ ${r.detail ?? 'Error al escribir'}`
}

function SidePlan({ side }: { side: Side }) {
  const { recipe, files, codePy, steps, markStep, resetSide, busy, setBusy } = useFlash()
  const devices = useLab((s) => s.devices)
  const { sendTo, addLog } = useLab()
  const defs = stepsFor(recipe, side)
  const state = steps[side]
  const current = defs.findIndex((_, i) => !state[i]?.done)
  const diagDevice = Object.values(devices).find((d) => d.kind === 'webserial' && d.side === side && d.status === 'connected')

  const runWrite = async (i: number, def: Extract<StepDef, { kind: 'write' }>) => {
    const file = def.role === 'codepy' ? null : pick(files, def.role)
    const name = def.role === 'codepy' ? 'code.py' : file?.name
    const bytes = def.role === 'codepy' ? codePy : file?.bytes
    if (!name || !bytes) return
    setBusy(`${side}-${i}`)
    addLog('info', `Escribiendo ${name} en la mitad ${sideEs(side)}…`)
    const result = await flashFile(name, bytes, def.target)
    setBusy(null)
    const ok = result.status === 'ok' || result.status === 'probable'
    markStep(side, i, { done: ok, result })
    addLog(ok ? 'ok' : result.status === 'cancelled' ? 'warn' : 'error', `${name}: ${describe(result)}`)
  }

  const reboot = async (i: number) => {
    await sendTo(side, { cmd: 'bootloader' })
    addLog('info', `Mitad ${sideEs(side)}: reiniciando al bootloader…`)
    markStep(side, i, { done: true })
  }

  return (
    <div className="side-plan">
      <div className="side-title">
        <b>Mitad {sideEs(side)}</b>
        <button className="btn tiny ghost" onClick={() => resetSide(side)}>Reiniciar pasos</button>
      </div>
      <ol>
        {defs.map((def, i) => {
          const st = state[i]
          const active = i === current
          const cls = st?.done ? 'done' : active ? 'active' : 'todo'
          return (
            <li key={i} className={cls}>
              <div className="step-title">{st?.done ? '✓' : i + 1}. {def.title}</div>
              <div className="step-hint">{def.hint}</div>
              {active && def.kind === 'boot' && (
                <div className="row wrap">
                  {diagDevice ? (
                    <button className="btn primary tiny" onClick={() => reboot(i)}>⟲ Reiniciar al bootloader</button>
                  ) : (
                    <span className="step-hint">Doble tap rápido al reset (dos toques en menos de medio segundo).</span>
                  )}
                  <button className="btn tiny" onClick={() => markStep(side, i, { done: true })}>Ya veo NICENANO</button>
                </div>
              )}
              {active && def.kind === 'manual' && (
                <div className="row">
                  <button className="btn tiny" onClick={() => markStep(side, i, { done: true })}>{def.cta}</button>
                </div>
              )}
              {active && def.kind === 'write' && (() => {
                const file = def.role === 'codepy' ? null : pick(files, def.role)
                const ready = def.role === 'codepy' ? !!codePy : !!file
                return (
                  <div className="row wrap">
                    <button className="btn primary tiny" disabled={!ready || !!busy} onClick={() => runWrite(i, def)}>
                      {busy === `${side}-${i}` ? 'Escribiendo…' : `⬇ Escribir en ${def.target === 'nicenano' ? 'NICENANO' : 'CIRCUITPY'}`}
                    </button>
                    {!ready && <span className="step-hint warn">Falta: {def.role === 'codepy' ? 'code.py' : ROLE_LABEL[def.role as Uf2Role]}</span>}
                    {ready && file && <span className="step-hint">{file.name}</span>}
                  </div>
                )
              })()}
              {st?.result && <div className={`step-result ${st.done ? 'ok' : 'bad'}`}>{describe(st.result)}</div>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------------------
function SingleFlash() {
  const { files, codePy, busy, setBusy } = useFlash()
  const addLog = useLab((s) => s.addLog)
  const [sel, setSel] = useState<string>('codepy')
  const [result, setResult] = useState<WriteResult>()
  const valid = files.filter((f) => f.info.valid)
  const run = async () => {
    const file = valid.find((f) => f.id === sel)
    const name = file ? file.name : 'code.py'
    const bytes = file ? file.bytes : codePy
    if (!bytes) return
    setBusy('single')
    const r = await flashFile(name, bytes, file ? 'nicenano' : 'circuitpy')
    setBusy(null)
    setResult(r)
    addLog(r.status === 'error' ? 'error' : 'info', `${name}: ${describe(r)}`)
  }
  return (
    <div className="single">
      <label className="field">
        Archivo
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="codepy">code.py (diagnóstico) → CIRCUITPY</option>
          {valid.map((f) => (
            <option key={f.id} value={f.id}>{f.name} → NICENANO</option>
          ))}
        </select>
      </label>
      <button className="btn primary" disabled={!!busy} onClick={run}>{busy ? 'Escribiendo…' : '⬇ Escribir'}</button>
      {result && <p className="hint">{describe(result)}</p>}
    </div>
  )
}
