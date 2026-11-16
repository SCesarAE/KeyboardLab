import { useEffect, useMemo, useRef, useState } from 'react'
import { adapters, sideName, useLab } from '../lib/store'
import { WebSerialAdapter, grantedPorts, isPortOpen, webSerialSupported } from '../lib/device/webSerial'
import { DemoAdapter } from '../lib/device/demo'
import { diagnose, labelOf } from '../lib/diagnostics'
import { COL_PINS, KEYS, LED_ORDER, ROW_PINS, keyId } from '../lib/layout/sofle'
import { EXPECTED_FW, type LedMode, type Side } from '../lib/protocol'

const BASE = import.meta.env.BASE_URL

export function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="panel">
      <header>
        <h3>{title}</h3>
        {right}
      </header>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
export function ConnectPanel() {
  const devices = useLab((s) => s.devices)
  const { attach, detach, setSide, setDemoMode, demoMode, sendTo } = useLab()
  const list = Object.values(devices)
  const supported = webSerialSupported()
  const [granted, setGranted] = useState(0)

  const refreshGranted = async () => setGranted((await grantedPorts()).filter((p) => !isPortOpen(p)).length)
  useEffect(() => {
    void refreshGranted()
  }, [list.length])

  const startDemo = async () => {
    setDemoMode(true)
    await attach(new DemoAdapter('left'))
    await attach(new DemoAdapter('right'))
  }
  const stopDemo = async () => {
    for (const d of list.filter((x) => x.kind === 'demo')) await detach(d.id)
    setDemoMode(false)
  }

  return (
    <Panel title="Conexión">
      {!supported && (
        <p className="notice">
          Este navegador no expone <code>Web Serial</code>. Usa Chrome o Edge en escritorio. Mientras, prueba el modo demo.
        </p>
      )}
      <div className="row wrap">
        <button className="btn primary" disabled={!supported} onClick={() => attach(new WebSerialAdapter())}>
          ⚡ Conectar mitad (USB)
        </button>
        {granted > 0 && (
          <button className="btn" onClick={() => reconnectGranted()}>
            ↻ Reconectar {granted} autorizada{granted > 1 ? 's' : ''}
          </button>
        )}
        {demoMode ? (
          <button className="btn" onClick={stopDemo}>Salir de demo</button>
        ) : (
          <button className="btn" onClick={startDemo}>Modo demo</button>
        )}
      </div>
      <p className="hint">
        Para la segunda mitad pulsa otra vez “Conectar mitad” y elige el otro puerto. Chrome recuerda ambos: la próxima vez se
        conectan solos.
      </p>
      {demoMode && (
        <p className="hint">
          Demo: usa tu teclado (QWERTY) o haz clic en las teclas 3D. Encoders: ←/→ izquierda, ↑/↓ derecha.
        </p>
      )}
      <ul className="devices">
        {list.length === 0 && <li className="muted">Sin dispositivos. Conecta una mitad con el firmware de diagnóstico.</li>}
        {list.map((d) => {
          const oldFw = d.kind === 'webserial' && d.version && d.version !== EXPECTED_FW
          return (
            <li key={d.id} className={d.side === 'unknown' && d.fw ? 'needs-side' : ''}>
              <div className="dev-head">
                <span className={`dot ${d.status}`} />
                <b>{d.label}</b>
                <button className="btn tiny ghost" onClick={() => detach(d.id)} title="Desconectar">✕</button>
              </div>
              <div className="dev-meta">
                {d.fw ? `${d.fw} v${d.version}` : 'Esperando saludo del firmware…'} · lado: {sideName(d.side)}
                {d.vcc === false && ' · VCC apagado'}
              </div>
              {oldFw && (
                <p className="notice">
                  Este code.py es v{d.version}; la app espera v{EXPECTED_FW}. Descarga el nuevo y cópialo a CIRCUITPY.
                </p>
              )}
              {d.kind === 'webserial' && d.side === 'unknown' && d.fw && (
                <p className="hint">¿Qué mitad es? Mira la serigrafía LEFT / RIGHT junto al encoder. Se guarda en la placa.</p>
              )}
              {d.kind === 'webserial' && (
                <div className="row">
                  {(['left', 'right'] as Side[]).map((s) => (
                    <button key={s} className={`btn tiny ${d.side === s ? 'on' : ''}`} onClick={() => setSide(d.id, s)}>
                      {s === 'left' ? 'Izquierda' : 'Derecha'}
                    </button>
                  ))}
                  {d.vcc === false && d.side !== 'unknown' && (
                    <button className="btn tiny" onClick={() => sendTo(d.side as Side, { cmd: 'vcc', on: true })}>
                      Encender VCC
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/** Conecta todos los puertos que Chrome ya autorizó (sin abrir el selector) */
let reconnecting = false
export async function reconnectGranted() {
  if (reconnecting) return
  reconnecting = true
  try {
    const ports = (await grantedPorts()).filter((p) => !isPortOpen(p))
    for (const p of ports) await useLab.getState().attach(new WebSerialAdapter(p))
  } finally {
    reconnecting = false
  }
}

// ---------------------------------------------------------------------------
export function FirmwareGuide() {
  const [open, setOpen] = useState(false)
  return (
    <Panel
      title="Firmware de diagnóstico"
      right={<button className="btn tiny ghost" onClick={() => setOpen(!open)}>{open ? 'Ocultar' : 'Ver pasos'}</button>}
    >
      {open ? (
        <ol className="steps">
          <li>
            Descarga CircuitPython para nice!nano (<code>.uf2</code>) en{' '}
            <a href="https://circuitpython.org/board/nice_nano/" target="_blank" rel="noreferrer">circuitpython.org</a>.
          </li>
          <li>Doble tap al reset → aparece <code>NICENANO</code>. Arrastra ahí el <code>.uf2</code>.</li>
          <li>Aparece la unidad <code>CIRCUITPY</code>. Copia ahí este archivo:</li>
          <li className="no-num">
            <a className="btn primary" href={`${BASE}firmware/code.py`} download="code.py">⬇ code.py</a>
          </li>
          <li>Pulsa “Conectar mitad”, elige el puerto <code>CircuitPython</code> y asigna el lado.</li>
          <li>
            Para volver a ZMK usa la pestaña <b>Flash</b> → “ZMK limpio”: reinicia al bootloader sin doble tap y escribe
            <code> settings_reset</code> y luego <code>sofle_left</code> / <code>sofle_right</code>.
          </li>
        </ol>
      ) : (
        <p className="muted">CircuitPython + un solo archivo. Instálalo desde la pestaña Flash → “Volver al diagnóstico”.</p>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
function useTick(ms: number) {
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}

export function TestPanel({ sides }: { sides: Side[] }) {
  useTick(1000)
  const keys = useLab((s) => s.keys)
  const encoders = useLab((s) => s.encoders)
  const resetTests = useLab((s) => s.resetTests)
  const { reports, issues } = useMemo(() => diagnose(keys, sides, performance.now()), [keys, sides])

  return (
    <Panel title="Prueba de matriz" right={<button className="btn tiny ghost" onClick={() => resetTests()}>Reiniciar</button>}>
      {sides.length === 0 && <p className="muted">Conecta una mitad y asígnale un lado para empezar.</p>}
      {reports.map((r) => {
        const pct = Math.round((100 * r.tested) / r.total)
        const e = encoders[r.side]
        return (
          <div key={r.side} className="progress">
            <div className="progress-head">
              <span>Mitad {sideName(r.side)}</span>
              <b>{r.tested}/{r.total}</b>
            </div>
            <div className="bar"><i style={{ width: `${pct}%` }} /></div>
            <div className="enc-status">
              Encoder: <span className={e.cw ? 'ok' : ''}>↻ horario {e.cw ? '✓' : '·'}</span>
              <span className={e.ccw ? 'ok' : ''}>↺ antihorario {e.ccw ? '✓' : '·'}</span>
            </div>
          </div>
        )
      })}
      <div className="issues">
        {sides.length > 0 && issues.length === 0 && reports.every((r) => r.tested === r.total) && (
          <div className="issue ok">✓ Todas las teclas responden. Listo para soldar lo siguiente o pasar a ZMK.</div>
        )}
        {issues.map((i, n) => (
          <div key={n} className={`issue ${i.level}`}>
            <b>{i.title}</b>
            <span>{i.detail}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
export function MatrixGrid({ side }: { side: Side }) {
  const keys = useLab((s) => s.keys)
  const cols = side === 'left' ? [0, 1, 2, 3, 4, 5] : [5, 4, 3, 2, 1, 0]
  return (
    <div className="matrix">
      <div className="matrix-title">Matriz {sideName(side)}</div>
      <table>
        <thead>
          <tr>
            <th />
            {cols.map((c) => <th key={c}>{COL_PINS[c]}</th>)}
          </tr>
        </thead>
        <tbody>
          {ROW_PINS.map((pin, r) => (
            <tr key={r}>
              <th>{pin}</th>
              {cols.map((c) => {
                const id = keyId(side, r, c)
                const k = keys[id]
                const def = KEYS.find((x) => x.id === id)
                const cls = k?.pressed ? 'pressed' : (k?.bounces ?? 0) >= 2 ? 'bounce' : k?.count ? 'tested' : ''
                return (
                  <td key={c} className={cls} title={labelOf(id)}>
                    {def?.sw.replace('SW', '')}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
const MODES: { id: LedMode; label: string }[] = [
  { id: 'off', label: 'Apagar' },
  { id: 'all', label: 'Todos' },
  { id: 'one', label: 'Uno' },
  { id: 'chase', label: 'Persecución' },
  { id: 'rainbow', label: 'Arcoíris' },
]

const hexToRgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
]

export function LedPanel({ sides }: { sides: Side[] }) {
  const led = useLab((s) => s.led)
  const { setLed, sendTo } = useLab()
  const [color, setColor] = useState('#00ffff')
  const [br, setBr] = useState(0.15)
  const [target, setTarget] = useState<Side | 'both'>('both')
  const [walk, setWalk] = useState(false)
  const idx = led.index ?? 0
  const disabled = sides.length === 0
  const walkRef = useRef(idx)

  const apply = (patch: { mode?: LedMode; index?: number; rgb?: [number, number, number]; br?: number }) => {
    const mode = patch.mode ?? led.mode
    const rgb = patch.rgb ?? hexToRgb(color)
    const i = patch.index ?? idx
    setLed({ mode, rgb, index: i, side: target })
    void sendTo(target, { cmd: 'led', mode, rgb, i, br: patch.br ?? br })
  }

  // Recorrido automatico: un LED a la vez para detectar LEDs muertos en la cadena
  useEffect(() => {
    if (!walk) return
    walkRef.current = idx
    const t = setInterval(() => {
      walkRef.current = (walkRef.current + 1) % LED_ORDER.length
      apply({ mode: 'one', index: walkRef.current })
    }, 700)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walk])

  const [r, c] = LED_ORDER[idx] ?? [0, 0]

  return (
    <Panel title="LEDs por tecla">
      <div className="row wrap">
        {(['both', 'left', 'right'] as const).map((s) => (
          <button key={s} className={`btn tiny ${target === s ? 'on' : ''}`} onClick={() => setTarget(s)}>
            {s === 'both' ? 'Ambas' : s === 'left' ? 'Izquierda' : 'Derecha'}
          </button>
        ))}
      </div>
      <div className="row wrap">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`btn tiny ${led.mode === m.id ? 'on' : ''}`}
            onClick={() => (setWalk(false), apply({ mode: m.id }))}
          >
            {m.label}
          </button>
        ))}
      </div>
      <label className="field">
        Color
        <input type="color" value={color} onChange={(e) => (setColor(e.target.value), apply({ rgb: hexToRgb(e.target.value) }))} />
      </label>
      <label className="field">
        Brillo {Math.round(br * 100)}% <small>(tope 35%)</small>
        <input
          type="range" min={0} max={0.35} step={0.01} value={br}
          onChange={(e) => setBr(Number(e.target.value))}
          onPointerUp={() => apply({ br })}
        />
      </label>
      <label className="field">
        LED #{idx} → {labelOf(keyId(target === 'right' ? 'right' : 'left', r, c))}
        <input
          type="range" min={0} max={LED_ORDER.length - 1} value={idx}
          onChange={(e) => apply({ mode: 'one', index: Number(e.target.value) })}
        />
      </label>
      <div className="row">
        <button className={`btn ${walk ? 'on' : ''}`} onClick={() => setWalk(!walk)}>
          {walk ? '■ Detener recorrido' : '▶ Recorrido LED por LED'}
        </button>
      </div>
      <p className="hint">
        {disabled
          ? 'Vista previa en el modelo 3D. Conecta una mitad para encender los LEDs reales.'
          : 'Si un LED no enciende y los siguientes tampoco, revisa ese LED: la cadena se corta ahí.'}
      </p>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
export function LogPanel() {
  const log = useLab((s) => s.log)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight })
  }, [log])
  return (
    <div className="log" ref={box}>
      {log.slice(-80).map((e) => (
        <div key={e.id} className={`log-${e.level}`}>
          <time>{new Date(e.at).toLocaleTimeString()}</time> {e.text}
        </div>
      ))}
      {log.length === 0 && <div className="muted">Bitácora vacía.</div>}
    </div>
  )
}

export const connectedDemo = (side: Side) =>
  [...adapters.values()].find((a) => a instanceof DemoAdapter && a.side === side) as DemoAdapter | undefined

// ---------------------------------------------------------------------------
/** Tooltip unico que sigue al mouse (evita montar 60 overlays dentro del canvas) */
export function KeyTooltip() {
  const hovered = useLab((s) => s.hovered)
  const stat = useLab((s) => (s.hovered ? s.keys[s.hovered] : undefined))
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useEffect(() => {
    const move = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY })
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [])
  if (!hovered) return null
  const [, r, c] = hovered.split(':').map(Number)
  const ledIndex = LED_ORDER.findIndex(([lr, lc]) => lr === r && lc === c)
  return (
    <div className="tip floating" style={{ left: pos.x + 14, top: pos.y + 14 }}>
      <b>{labelOf(hovered)}</b>
      <span>{stat?.count ? `${stat.count} pulsaciones${stat.bounces ? ` · ${stat.bounces} rebotes` : ''}` : 'sin probar'}</span>
      <span>{ledIndex >= 0 ? `LED #${ledIndex}` : 'sin LED'}</span>
    </div>
  )
}
