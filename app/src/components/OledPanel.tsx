import { useEffect, useRef, useState } from 'react'
import type { Side } from '../lib/protocol'
import { sideName, useLab } from '../lib/store'
import {
  ANIMATIONS, ORIENTATIONS, bitsToImage, imageBits, isVertical, makeAnimation, pack, patternBits, textBits, toBase64,
  virtualSize, type AnimId, type Orientation,
} from '../lib/oled'
import { Panel } from './Panels'

const FPS = 12

export default function OledPanel() {
  const devices = useLab((s) => s.devices)
  const { sendTo, setOledFrame, addLog } = useLab()
  const [target, setTarget] = useState<Side | 'both'>('both')
  const [orient, setOrient] = useState<Orientation>('v')
  const [text, setText] = useState('Hola Cesar')
  const [anim, setAnim] = useState<AnimId | null>(null)
  const [invert, setInvert] = useState(false)
  const [contrast, setContrast] = useState(143)
  const preview = useRef<HTMLCanvasElement>(null)
  const running = useRef(false)

  const connected = Object.values(devices).filter((d) => d.kind === 'webserial' && d.status === 'connected' && d.side !== 'unknown')

  const [vw, vh] = virtualSize(orient)
  const [last, setLast] = useState<Uint8Array | null>(null)

  // Vista previa en la orientacion elegida (como se vera montada en el teclado)
  useEffect(() => {
    const ctx = preview.current?.getContext('2d')
    if (!ctx) return
    if (last && last.length === vw * vh) bitsToImage(last, vw, vh, ctx)
    else {
      ctx.fillStyle = '#04060a'
      ctx.fillRect(0, 0, vw, vh)
    }
  }, [last, vw, vh])

  const show = async (bits: Uint8Array) => {
    setLast(bits)
    const buf = pack(bits, orient)
    setOledFrame(target, buf)
    await sendTo(target, { cmd: 'oled', op: 'frame', b64: toBase64(buf) })
  }

  // Animacion: cuadros a ~12 fps; cada envio espera al anterior para no saturar el puerto
  useEffect(() => {
    if (!anim) return
    running.current = true
    const next = makeAnimation(anim, orient)
    let f = 0
    void (async () => {
      while (running.current) {
        const t0 = performance.now()
        await show(next(f++))
        const wait = 1000 / FPS - (performance.now() - t0)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      }
    })()
    return () => {
      running.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim, orient, target])

  const stop = () => setAnim(null)

  const probe = async () => {
    stop()
    if (!connected.length) return addLog('warn', 'Conecta una mitad con code.py 0.2.0 para probar la OLED')
    await sendTo(target, { cmd: 'oled', op: 'init' })
    const border = patternBits('border', orient)
    setLast(border)
    setOledFrame(target, pack(border, orient))
  }

  return (
    <Panel title="Pantalla OLED 128×32">
      <div className="oled-status">
        {connected.length === 0 && <span className="muted">Vista previa sin hardware. Conecta una mitad para la pantalla real.</span>}
        {connected.map((d) => (
          <span key={d.id} className={d.oled ? 'ok' : d.oled === false ? 'bad' : ''}>
            {sideName(d.side)}: {d.oled ? 'detectada' : d.oled === false ? 'no responde' : '¿?'}
          </span>
        ))}
      </div>

      <div className={`oled-wrap ${isVertical(orient) ? 'vertical' : ''}`}>
        <canvas ref={preview} width={vw} height={vh} className="oled-preview" />
      </div>

      <div className="row wrap">
        {(['both', 'left', 'right'] as const).map((s) => (
          <button key={s} className={`btn tiny ${target === s ? 'on' : ''}`} onClick={() => setTarget(s)}>
            {s === 'both' ? 'Ambas' : s === 'left' ? 'Izquierda' : 'Derecha'}
          </button>
        ))}
      </div>
      <label className="field">
        Orientación
        <select value={orient} onChange={(e) => setOrient(e.target.value as Orientation)}>
          {ORIENTATIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </label>

      <div className="row wrap">
        <button className="btn tiny primary" onClick={probe}>Probar (detectar)</button>
        <button className="btn tiny" onClick={() => (stop(), void show(patternBits('fill', orient)))}>Llenar</button>
        <button className="btn tiny" onClick={() => (stop(), void show(patternBits('checker', orient)))}>Tablero</button>
        <button className="btn tiny" onClick={() => (stop(), void show(patternBits('border', orient)))}>Borde</button>
        <button className="btn tiny" onClick={() => (stop(), void show(patternBits('clear', orient)))}>Apagar</button>
      </div>

      <label className="field">
        Texto
        <div className="row">
          <input className="text" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} />
          <button className="btn tiny" onClick={() => (stop(), void show(textBits(text, orient)))}>Enviar</button>
        </div>
      </label>

      <div className="field">
        Animaciones
        <div className="row wrap">
          {ANIMATIONS.map((a) => (
            <button key={a.id} className={`btn tiny ${anim === a.id ? 'on' : ''}`} onClick={() => setAnim(anim === a.id ? null : a.id)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        Imagen (se convierte a 1 bit con difuminado)
        <input
          type="file"
          accept="image/*"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            stop()
            await show(await imageBits(f, orient))
          }}
        />
      </label>

      <label className="field">
        Contraste {contrast}
        <input
          type="range" min={0} max={255} value={contrast}
          onChange={(e) => setContrast(Number(e.target.value))}
          onPointerUp={() => sendTo(target, { cmd: 'oled', op: 'contrast', v: contrast })}
        />
      </label>
      <div className="row">
        <button
          className={`btn tiny ${invert ? 'on' : ''}`}
          onClick={() => (setInvert(!invert), void sendTo(target, { cmd: 'oled', op: 'invert', v: !invert }))}
        >
          Invertir colores
        </button>
      </div>
    </Panel>
  )
}
