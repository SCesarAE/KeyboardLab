import { useEffect, useMemo } from 'react'
import Keyboard3D from './components/Keyboard3D'
import {
  ConnectPanel, FirmwareGuide, KeyTooltip, LedPanel, LogPanel, MatrixGrid, TestPanel, connectedDemo, reconnectGranted,
} from './components/Panels'
import { useLab } from './lib/store'
import { DEMO_KEYMAP } from './lib/layout/sofle'
import type { Side } from './lib/protocol'

export default function App() {
  const devices = useLab((s) => s.devices)
  const demoMode = useLab((s) => s.demoMode)

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

  return (
    <div className="app">
      <div className="stage">
        <Keyboard3D activeSides={sides} />
      </div>

      <header className="topbar">
        <div className="brand">
          <span className="logo">⌁</span>
          <div>
            <h1>KeyboardLab</h1>
            <p>Fase 1 · Diagnóstico de matriz · Sofle Choc + nice!nano</p>
          </div>
        </div>
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
        <FirmwareGuide />
        <LedPanel sides={sides} />
      </aside>

      <aside className="col right">
        <TestPanel sides={sides} />
      </aside>

      <KeyTooltip />

      <footer className="bottom">
        <MatrixGrid side="left" />
        <LogPanel />
        <MatrixGrid side="right" />
      </footer>
    </div>
  )
}
