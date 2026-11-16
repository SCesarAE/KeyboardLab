import { useEffect, useMemo } from 'react'
import Keyboard3D from './components/Keyboard3D'
import FlashView from './components/FlashView'
import OledPanel from './components/OledPanel'
import {
  ConnectPanel, FirmwareGuide, KeyTooltip, LedPanel, LogPanel, MatrixGrid, TestPanel, ZmkPanel, connectedDemo,
  reconnectGranted,
} from './components/Panels'
import { useLab } from './lib/store'
import { DEMO_KEYMAP, ZMK_ENCODERS, ZMK_KEYMAP } from './lib/layout/sofle'
import { adapters } from './lib/store'
import { DemoAdapter } from './lib/device/demo'
import type { Side } from './lib/protocol'

export default function App() {
  const devices = useLab((s) => s.devices)
  const demoMode = useLab((s) => s.demoMode)
  const view = useLab((s) => s.view)
  const setView = useLab((s) => s.setView)

  const sides = useMemo(() => {
    const set = new Set<Side>()
    for (const d of Object.values(devices)) if (d.status === 'connected' && d.side !== 'unknown') set.add(d.side)
    return (['left', 'right'] as Side[]).filter((s) => set.has(s))
  }, [devices])

  // Al abrir la app, reconecta las mitades que Chrome ya autorizo
  useEffect(() => {
    void reconnectGranted()
    if (!('serial' in navigator)) return
    // Cuando una placa autorizada vuelve a aparecer (p. ej. tras copiar code.py), se reconecta sola
    let t: ReturnType<typeof setTimeout>
    const onConnect = () => {
      clearTimeout(t)
      t = setTimeout(() => void reconnectGranted(), 1200)
    }
    navigator.serial.addEventListener('connect', onConnect)
    return () => navigator.serial.removeEventListener('connect', onConnect)
  }, [])

  // Modo demo: el teclado de la PC simula la matriz
  useEffect(() => {
    if (!demoMode) return
    const down = new Set<string>()
    const handler = (pressed: boolean) => (e: KeyboardEvent) => {
      const enc: Record<string, [Side, 1 | -1]> = {
        ArrowLeft: ['left', -1], ArrowRight: ['left', 1], ArrowDown: ['right', -1], ArrowUp: ['right', 1],
      }
      if (enc[e.code] && pressed) {
        e.preventDefault()
        const [side, dir] = enc[e.code]
        connectedDemo(side)?.turn(side === 'right' ? (-dir as 1 | -1) : dir)
        return
      }
      const id = DEMO_KEYMAP[e.code]
      if (!id) return
      e.preventDefault()
      if (pressed && down.has(e.code)) return // ignora autorepeticion
      pressed ? down.add(e.code) : down.delete(e.code)
      const [side, r, c] = id.split(':')
      connectedDemo(side as Side)?.key(Number(r), Number(c), pressed)
    }
    const onDown = handler(true)
    const onUp = handler(false)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [demoMode])

  // Prueba con ZMK: las teclas llegan como pulsaciones normales del teclado
  const zmkMode = useLab((s) => s.zmkMode)
  useEffect(() => {
    if (!zmkMode) return
    const zmk = (side: Side) =>
      [...adapters.values()].find((a) => a instanceof DemoAdapter && a.kind === 'zmk' && a.side === side) as DemoAdapter | undefined
    const down = new Set<string>()
    let pendingCtrl: ReturnType<typeof setTimeout> | null = null
    const emit = (code: string, pressed: boolean) => {
      const id = ZMK_KEYMAP[code]
      if (!id) return
      const [side, r, c] = id.split(':')
      zmk(side as Side)?.key(Number(r), Number(c), pressed)
    }
    const onDown = (e: KeyboardEvent) => {
      const enc = ZMK_ENCODERS[e.code]
      if (enc) {
        e.preventDefault()
        const [side, dir] = enc
        zmk(side)?.turn(side === 'right' ? (-dir as 1 | -1) : dir)
        return
      }
      if (!ZMK_KEYMAP[e.code]) return
      e.preventDefault()
      if (down.has(e.code)) return
      down.add(e.code)
      // En distribución español, AltGr (Alt derecho) también envía Ctrl izquierdo: se descarta ese Ctrl
      if (e.code === 'ControlLeft') {
        pendingCtrl = setTimeout(() => ((pendingCtrl = null), emit('ControlLeft', true)), 40)
        return
      }
      if (e.code === 'AltRight' && pendingCtrl) {
        clearTimeout(pendingCtrl)
        pendingCtrl = null
        down.delete('ControlLeft')
      }
      emit(e.code, true)
    }
    const onUp = (e: KeyboardEvent) => {
      if (!ZMK_KEYMAP[e.code]) return
      e.preventDefault()
      if (!down.has(e.code)) return
      down.delete(e.code)
      emit(e.code, false)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [zmkMode])

  return (
    <div className={`app view-${view}`}>
      <div className="stage">
        <Keyboard3D activeSides={sides} />
      </div>

      <header className="topbar">
        <div className="brand">
          <span className="logo">⌁</span>
          <div>
            <h1>KeyboardLab</h1>
            <p>Sofle Choc + nice!nano · diagnóstico y flash</p>
          </div>
        </div>
        <nav className="tabs">
          <button className={view === 'diag' ? 'on' : ''} onClick={() => setView('diag')}>Diagnóstico</button>
          <button className={view === 'flash' ? 'on' : ''} onClick={() => setView('flash')}>Flash</button>
          <button disabled title="Fase 5">Keymap</button>
        </nav>
        <div className="chips">
          {(['left', 'right'] as Side[]).map((s) => (
            <span key={s} className={`chip ${sides.includes(s) ? 'live' : ''}`}>
              {s === 'left' ? 'IZQ' : 'DER'} {sides.includes(s) ? 'en línea' : 'offline'}
            </span>
          ))}
        </div>
      </header>

      <aside className="col left">
        <ConnectPanel />
        {view === 'diag' && <ZmkPanel />}
        {view === 'diag' && <FirmwareGuide />}
        {view === 'diag' && <LedPanel sides={sides} />}
      </aside>

      {view === 'diag' ? (
        <aside className="col right">
          <TestPanel sides={sides} />
          <OledPanel />
        </aside>
      ) : (
        <main className="col flash-col">
          <FlashView />
        </main>
      )}

      <KeyTooltip />

      <footer className="bottom">
        {view === 'diag' && <MatrixGrid side="left" />}
        <LogPanel />
        {view === 'diag' && <MatrixGrid side="right" />}
      </footer>
    </div>
  )
}
