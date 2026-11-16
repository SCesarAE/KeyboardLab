import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Grid, OrbitControls, RoundedBox, Sparkles } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { EXTRAS, KEYS, LED_ORDER, type KeyDef } from '../lib/layout/sofle'
import { adapters, useLab, type KeyStat } from '../lib/store'
import { DemoAdapter } from '../lib/device/demo'
import type { Side } from '../lib/protocol'
import { unpackToImage } from '../lib/oled'

// ---------------------------------------------------------------------------
// Geometria: 1u (100 unidades de layout) = 1 unidad del mundo 3D
// ---------------------------------------------------------------------------
const U = 100
const PCB_TOP = 0.1
const CAP_Y = PCB_TOP + 0.32
const HALF_ORIGIN: Record<Side, [number, number]> = { left: [350, 250], right: [1150, 250] }
const HALF_POS: Record<Side, [number, number, number]> = { left: [-4.3, 0, 0], right: [4.3, 0, 0] }
const HALF_YAW: Record<Side, number> = { left: 0.1, right: -0.1 }

const COLORS = {
  idle: new THREE.Color('#00ff9c'),
  tested: new THREE.Color('#00ff9c'),
  pressed: new THREE.Color('#00e5ff'),
  bounce: new THREE.Color('#ffb020'),
  stuck: new THREE.Color('#ff2d6f'),
}
// Color base (claro) de cada estado, para que el teclado resalte sobre el fondo oscuro
const BASE = {
  idle: new THREE.Color('#c9d4e3'),
  tested: new THREE.Color('#8af7c9'),
  pressed: new THREE.Color('#c4f7ff'),
  bounce: new THREE.Color('#ffd27a'),
  stuck: new THREE.Color('#ff86ab'),
}

/** Centro de la tecla rotada, en unidades de layout */
function keyCenter(k: KeyDef): [number, number] {
  const cx = k.x + k.w / 2
  const cy = k.y + k.h / 2
  if (!k.rot) return [cx, cy]
  const a = (k.rot * Math.PI) / 180
  const dx = cx - k.rx
  const dy = cy - k.ry
  return [k.rx + dx * Math.cos(a) - dy * Math.sin(a), k.ry + dx * Math.sin(a) + dy * Math.cos(a)]
}

/** Esquinas de la tecla (para el contorno de la PCB) */
function keyCorners(k: KeyDef, pad: number): [number, number][] {
  const [cx, cy] = keyCenter(k)
  const a = (k.rot * Math.PI) / 180
  const hw = k.w / 2 + pad
  const hh = k.h / 2 + pad
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [
    cx + x * Math.cos(a) - y * Math.sin(a),
    cy + x * Math.sin(a) + y * Math.cos(a),
  ])
}

function convexHull(points: [number, number][]) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/** Layout -> coordenadas locales de la mitad (x derecha, z hacia la camara) */
const toLocal = (side: Side, x: number, y: number): [number, number] => [
  (x - HALF_ORIGIN[side][0]) / U,
  (y - HALF_ORIGIN[side][1]) / U,
]

// ---------------------------------------------------------------------------
function demoFor(side: Side) {
  for (const a of adapters.values()) if (a instanceof DemoAdapter && a.side === side) return a
  return null
}

function Keycap({ def, active }: { def: KeyDef; active: boolean }) {
  const stat = useLab((s) => s.keys[def.id]) as KeyStat | undefined
  const led = useLab((s) => s.led)
  const group = useRef<THREE.Group>(null)
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  const glow = useRef<THREE.MeshBasicMaterial>(null)
  const [hover, setHover] = useState(false)
  const setHovered = useLab((s) => s.setHovered)
  const sw = useRef<THREE.MeshStandardMaterial>(null)

  const [lx, lz] = useMemo(() => toLocal(def.side, ...keyCenter(def)), [def])
  const ledIndex = useMemo(() => LED_ORDER.findIndex(([r, c]) => r === def.row && c === def.col), [def])

  useFrame((state, dt) => {
    if (!group.current || !mat.current || !glow.current) return
    const now = performance.now()
    const stuck = !!stat?.pressed && now - stat.downAt > 4000
    let color = COLORS.idle
    let base = BASE.idle
    let intensity = 0
    if (stuck) [color, base, intensity] = [COLORS.stuck, BASE.stuck, 1.6]
    else if (stat?.pressed) [color, base, intensity] = [COLORS.pressed, BASE.pressed, 2.4]
    else if ((stat?.bounces ?? 0) >= 2) [color, base, intensity] = [COLORS.bounce, BASE.bounce, 0.8]
    else if (stat?.count) [color, base, intensity] = [COLORS.tested, BASE.tested, 0.35]

    const k = 1 - Math.exp(-dt * 14)
    mat.current.color.lerp(base, k)
    mat.current.emissive.lerp(color, k)
    mat.current.emissiveIntensity += (intensity - mat.current.emissiveIntensity) * k
    mat.current.opacity = active ? 1 : 0.5
    const targetY = CAP_Y - (stat?.pressed ? 0.12 : 0) + (hover ? 0.05 : 0)
    group.current.position.y += (targetY - group.current.position.y) * k

    // LED por tecla (simulacion de lo que deberia verse en la placa real)
    let on = false
    let rgb = led.rgb
    const sideMatch = led.side === 'both' || led.side === def.side
    if (sideMatch && ledIndex >= 0) {
      const t = state.clock.elapsedTime
      if (led.mode === 'all') on = true
      else if (led.mode === 'one') on = led.index === ledIndex
      else if (led.mode === 'chase') on = Math.floor(t * 25) % LED_ORDER.length === ledIndex
      else if (led.mode === 'rainbow') {
        on = true
        const c = new THREE.Color().setHSL(((t * 0.3 + ledIndex / LED_ORDER.length) % 1), 1, 0.5)
        rgb = [c.r * 255, c.g * 255, c.b * 255]
      }
    }
    glow.current.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
    glow.current.opacity += ((on ? 0.95 : 0) - glow.current.opacity) * k
    if (sw.current) {
      sw.current.emissive.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
      sw.current.emissiveIntensity = glow.current.opacity * 2.2
    }
  })

  const press = (down: boolean) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    demoFor(def.side)?.key(def.row, def.col, down)
  }

  const w = (def.w / U) * 0.88
  const d = (def.h / U) * 0.84

  return (
    <group position={[lx, 0, lz]} rotation={[0, (-def.rot * Math.PI) / 180, 0]}>
      {/* brillo del LED que atraviesa la PCB */}
      <mesh position={[0, PCB_TOP + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w * 1.35, d * 1.35]} />
        <meshBasicMaterial ref={glow} transparent opacity={0} toneMapped={false} />
      </mesh>
      {/* switch Choc */}
      <mesh position={[0, PCB_TOP + 0.1, 0]}>
        <boxGeometry args={[w * 0.82, 0.18, d * 0.82]} />
        <meshStandardMaterial ref={sw} color="#b8c4d6" transparent opacity={0.3} roughness={0.2} metalness={0.1} emissive="#000000" />
      </mesh>
      <group ref={group} position={[0, CAP_Y, 0]}>
        <RoundedBox
          args={[w, 0.2, d]}
          radius={0.05}
          smoothness={3}
          onPointerOver={(e) => (e.stopPropagation(), setHover(true), setHovered(def.id))}
          onPointerOut={() => (setHover(false), setHovered(null))}
          onPointerDown={press(true)}
          onPointerUp={press(false)}
          onPointerLeave={(e) => stat?.pressed && press(false)(e)}
        >
          <meshStandardMaterial ref={mat} color="#c9d4e3" emissive="#000000" emissiveIntensity={0} roughness={0.55} metalness={0.05} transparent />
        </RoundedBox>
      </group>
    </group>
  )
}

function Encoder({ side, active }: { side: Side; active: boolean }) {
  const enc = useLab((s) => s.encoders[side])
  const knob = useRef<THREE.Group>(null)
  const ring = useRef<THREE.MeshBasicMaterial>(null)
  const [x, z] = toLocal(side, ...EXTRAS[side].encoder)

  useFrame((_, dt) => {
    if (!knob.current || !ring.current) return
    const target = -enc.pos * ((Math.PI * 2) / 20)
    knob.current.rotation.y += (target - knob.current.rotation.y) * (1 - Math.exp(-dt * 12))
    const fresh = performance.now() - enc.lastAt < 350
    const color = enc.lastDir >= 0 ? COLORS.pressed : new THREE.Color('#d24bff')
    ring.current.color.copy(color)
    ring.current.opacity += ((fresh ? 1 : enc.cw + enc.ccw > 0 ? 0.25 : 0.05) - ring.current.opacity) * 0.2
  })

  return (
    <group position={[x, PCB_TOP, z]}>
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[0.62, 0.12, 0.62]} />
        <meshStandardMaterial color="#c9ced6" metalness={0.8} roughness={0.3} />
      </mesh>
      <group ref={knob} position={[0, 0.34, 0]}>
        <mesh>
          <cylinderGeometry args={[0.24, 0.26, 0.42, 24]} />
          <meshStandardMaterial color="#9aa6b5" metalness={0.85} roughness={0.3} transparent opacity={active ? 1 : 0.6} />
        </mesh>
        <mesh position={[0, 0.215, 0.13]}>
          <boxGeometry args={[0.04, 0.01, 0.14]} />
          <meshBasicMaterial color="#00e5ff" toneMapped={false} />
        </mesh>
      </group>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.36, 48]} />
        <meshBasicMaterial ref={ring} transparent opacity={0.05} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Controller({ side }: { side: Side }) {
  const tested = useLab((s) => KEYS.filter((k) => k.side === side && s.keys[k.id]?.count).length)
  const frame = useLab((s) => s.oledFrames[side])
  const total = KEYS.filter((k) => k.side === side).length
  const [x, z] = toLocal(side, ...EXTRAS[side].controller)
  const texture = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 32
    const t = new THREE.CanvasTexture(c)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])

  // OLED virtual 128x32: muestra el progreso (en la fase 2 mostrara tus animaciones)
  useEffect(() => {
    const ctx = (texture.image as HTMLCanvasElement).getContext('2d')!
    // Si se envio algo a la OLED real, el modelo muestra exactamente lo mismo
    if (frame) {
      unpackToImage(frame, ctx)
      texture.needsUpdate = true
      return
    }
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 128, 32)
    ctx.fillStyle = '#7fe9ff'
    ctx.font = 'bold 10px monospace'
    ctx.textBaseline = 'top'
    ctx.fillText(side === 'left' ? 'KBLAB  IZQ' : 'KBLAB  DER', 3, 2)
    ctx.fillText(`${tested}/${total} OK`, 3, 13)
    ctx.strokeStyle = '#7fe9ff'
    ctx.strokeRect(70, 15, 54, 8)
    ctx.fillRect(72, 17, Math.round((50 * tested) / total), 4)
    texture.needsUpdate = true
  }, [tested, total, side, texture, frame])

  return (
    <group position={[x, PCB_TOP, z]}>
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[0.95, 0.16, 1.62]} />
        <meshStandardMaterial color="#111" metalness={0.3} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.6, 0.06, 1.5]} />
        <meshStandardMaterial color="#05070a" metalness={0.2} roughness={0.1} />
      </mesh>
      {/* pantalla en vertical, como va montada en el Sofle */}
      <mesh position={[0, 0.235, 0]} rotation={[-Math.PI / 2, 0, side === 'left' ? -Math.PI / 2 : Math.PI / 2]}>
        <planeGeometry args={[1.36, 0.34]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Half({ side, active }: { side: Side; active: boolean }) {
  const keys = useMemo(() => KEYS.filter((k) => k.side === side), [side])
  const outline = useMemo(() => {
    const pts = keys.flatMap((k) => keyCorners(k, 14))
    const [ex, ey] = EXTRAS[side].controller
    pts.push([ex - 60, ey - 95], [ex + 60, ey - 95], [ex - 60, ey + 175], [ex + 60, ey + 175])
    const hull = convexHull(pts).map(([x, y]) => toLocal(side, x, y))
    const shape = new THREE.Shape(hull.map(([x, z]) => new THREE.Vector2(x, -z)))
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: PCB_TOP,
      bevelEnabled: true,
      bevelSize: 0.04,
      bevelThickness: 0.03,
      bevelSegments: 2,
    })
    geo.rotateX(-Math.PI / 2)
    return geo
  }, [keys, side])
  const edges = useMemo(() => new THREE.EdgesGeometry(outline, 30), [outline])

  return (
    <group position={HALF_POS[side]} rotation={[0, HALF_YAW[side], 0]}>
      <mesh geometry={outline}>
        <meshStandardMaterial color="#1d2a3c" metalness={0.35} roughness={0.5} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={active ? '#5ff0ff' : '#4d7391'} transparent opacity={active ? 1 : 0.7} />
      </lineSegments>
      {keys.map((k) => (
        <Keycap key={k.id} def={k} active={active} />
      ))}
      <Encoder side={side} active={active} />
      <Controller side={side} />
    </group>
  )
}

export default function Keyboard3D({ activeSides }: { activeSides: Side[] }) {
  return (
    <Canvas camera={{ position: [0, 16.5, 15.5], fov: 38 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={['#04060b']} />
      <fog attach="fog" args={['#04060b', 26, 55]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#cdeeff', '#0a0f18', 0.7]} />
      <directionalLight position={[4, 12, 8]} intensity={1.5} />
      <pointLight position={[-6, 3, -4]} intensity={18} color="#7a3cff" />
      <pointLight position={[6, 3, 4]} intensity={14} color="#00e5ff" />
      <Grid
        position={[0, -0.02, 0]}
        args={[60, 60]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#0b2a3a"
        sectionSize={2.5}
        sectionThickness={1}
        sectionColor="#0e5e7e"
        fadeDistance={45}
        fadeStrength={1.4}
        infiniteGrid
      />
      <Sparkles count={60} scale={[22, 4, 12]} size={2} speed={0.25} color="#5ce1ff" opacity={0.5} />
      <Half side="left" active={activeSides.includes('left')} />
      <Half side="right" active={activeSides.includes('right')} />
      <OrbitControls
        target={[0, 0, 1.6]}
        enablePan={false}
        minDistance={6}
        maxDistance={34}
        maxPolarAngle={Math.PI / 2.15}
      />
      <EffectComposer>
        <Bloom intensity={0.9} luminanceThreshold={0.9} luminanceSmoothing={0.15} mipmapBlur />
        <Vignette eskil={false} offset={0.2} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  )
}
