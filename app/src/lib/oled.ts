// Utilidades para la OLED SSD1306 de 128x32 del Sofle.
//
// La app dibuja en un lienzo "virtual" (horizontal 128x32 o vertical 32x128, como va montada en el Sofle)
// y lo convierte al formato del controlador: 4 paginas x 128 columnas, cada byte = 8 pixeles en vertical.

export const OLED_W = 128
export const OLED_H = 32

export type Orientation = 'h' | 'h180' | 'v' | 'v270'

export const ORIENTATIONS: { id: Orientation; label: string }[] = [
  { id: 'v', label: 'Vertical ↻' },
  { id: 'v270', label: 'Vertical ↺' },
  { id: 'h', label: 'Horizontal' },
  { id: 'h180', label: 'Horizontal 180°' },
]

export const isVertical = (o: Orientation) => o === 'v' || o === 'v270'
export const virtualSize = (o: Orientation): [number, number] => (isVertical(o) ? [OLED_H, OLED_W] : [OLED_W, OLED_H])

/** Pixel virtual (vx, vy) -> pixel fisico (x, y) de la pantalla */
function toPhysical(o: Orientation, vx: number, vy: number): [number, number] {
  switch (o) {
    case 'h':
      return [vx, vy]
    case 'h180':
      return [OLED_W - 1 - vx, OLED_H - 1 - vy]
    case 'v':
      return [vy, OLED_H - 1 - vx]
    case 'v270':
      return [OLED_W - 1 - vy, vx]
  }
}

/** Mapa de bits virtual (1 = encendido) -> buffer de 512 bytes del SSD1306 */
export function pack(bits: Uint8Array, o: Orientation): Uint8Array {
  const [vw, vh] = virtualSize(o)
  const out = new Uint8Array((OLED_W * OLED_H) / 8)
  for (let vy = 0; vy < vh; vy++) {
    for (let vx = 0; vx < vw; vx++) {
      if (!bits[vy * vw + vx]) continue
      const [x, y] = toPhysical(o, vx, vy)
      out[(y >> 3) * OLED_W + x] |= 1 << (y & 7)
    }
  }
  return out
}

/** Bits virtuales -> canvas (vista previa en la orientacion en que se monta) */
export function bitsToImage(bits: Uint8Array, w: number, h: number, ctx: CanvasRenderingContext2D, on = '#7fe9ff') {
  const img = ctx.createImageData(w, h)
  const c = hex(on)
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = bits[i] ? c[0] : 4
    img.data[i * 4 + 1] = bits[i] ? c[1] : 6
    img.data[i * 4 + 2] = bits[i] ? c[2] : 10
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

/** Buffer SSD1306 -> pixeles RGBA de 128x32 (para la vista previa y el modelo 3D) */
export function unpackToImage(buf: Uint8Array, ctx: CanvasRenderingContext2D, on = '#7fe9ff') {
  const img = ctx.createImageData(OLED_W, OLED_H)
  const c = hex(on)
  for (let y = 0; y < OLED_H; y++) {
    for (let x = 0; x < OLED_W; x++) {
      const lit = (buf[(y >> 3) * OLED_W + x] >> (y & 7)) & 1
      const i = (y * OLED_W + x) * 4
      img.data[i] = lit ? c[0] : 4
      img.data[i + 1] = lit ? c[1] : 6
      img.data[i + 2] = lit ? c[2] : 10
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

export function toBase64(bytes: Uint8Array) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

/** Canvas en escala de grises -> bits, con umbral o con difuminado Floyd-Steinberg */
export function canvasToBits(ctx: CanvasRenderingContext2D, w: number, h: number, dither = false): Uint8Array {
  const data = ctx.getImageData(0, 0, w, h).data
  const g = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    g[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * (data[i * 4 + 3] / 255)
  }
  const bits = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const v = g[i] > 127 ? 255 : 0
      bits[i] = v ? 1 : 0
      if (!dither) continue
      const err = g[i] - v
      if (x + 1 < w) g[i + 1] += (err * 7) / 16
      if (y + 1 < h) {
        if (x > 0) g[i + w - 1] += (err * 3) / 16
        g[i + w] += (err * 5) / 16
        if (x + 1 < w) g[i + w + 1] += err / 16
      }
    }
  }
  return bits
}

export function blankCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = false
  return { c, ctx }
}

/** Texto ajustado al lienzo virtual (varias lineas en vertical) */
export function textBits(text: string, o: Orientation): Uint8Array {
  const [w, h] = virtualSize(o)
  const { ctx } = blankCanvas(w, h)
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'top'
  const vertical = isVertical(o)
  const size = vertical ? 8 : text.length <= 12 ? 14 : 10
  ctx.font = `bold ${size}px monospace`
  const words = text.toUpperCase().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word
    if (ctx.measureText(next).width > w - 2 && cur) {
      lines.push(cur)
      cur = word
    } else cur = next
  }
  if (cur) lines.push(cur)
  const lh = size + 2
  const top = Math.max(0, Math.floor((h - lines.length * lh) / 2))
  lines.forEach((l, i) => {
    const lw = ctx.measureText(l).width
    ctx.fillText(l, Math.max(1, Math.floor((w - lw) / 2)), top + i * lh)
  })
  return canvasToBits(ctx, w, h)
}

/** Imagen -> bits (ajuste "cover" y difuminado) */
export async function imageBits(file: File, o: Orientation): Promise<Uint8Array> {
  const [w, h] = virtualSize(o)
  const bmp = await createImageBitmap(file)
  const { ctx } = blankCanvas(w, h)
  const scale = Math.max(w / bmp.width, h / bmp.height)
  const dw = bmp.width * scale
  const dh = bmp.height * scale
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh)
  return canvasToBits(ctx, w, h, true)
}

// ---------------------------------------------------------------------------
// Animaciones de prueba: devuelven un generador de cuadros (bits virtuales)
// ---------------------------------------------------------------------------
export type AnimId = 'scanner' | 'rain' | 'marquee' | 'eq' | 'life'

export const ANIMATIONS: { id: AnimId; label: string }[] = [
  { id: 'scanner', label: 'Escáner' },
  { id: 'rain', label: 'Lluvia' },
  { id: 'marquee', label: 'Marquesina' },
  { id: 'eq', label: 'Ecualizador' },
  { id: 'life', label: 'Vida (Conway)' },
]

export function makeAnimation(id: AnimId, o: Orientation): (frame: number) => Uint8Array {
  const [w, h] = virtualSize(o)
  const along = Math.max(w, h) // eje largo
  const across = Math.min(w, h)
  const set = (bits: Uint8Array, a: number, b: number) => {
    // a = eje largo, b = eje corto (independiente de la orientacion)
    const [x, y] = w >= h ? [a, b] : [b, a]
    if (x >= 0 && y >= 0 && x < w && y < h) bits[y * w + x] = 1
  }

  if (id === 'scanner') {
    return (f) => {
      const bits = new Uint8Array(w * h)
      const period = (along - 6) * 2
      const p = f % period
      const pos = p < along - 6 ? p : period - p
      for (let t = 0; t < 4; t++) {
        const trail = pos - (p < along - 6 ? 1 : -1) * t * 3
        for (let b = 0; b < across; b++) if (t === 0 || (b + t) % (t + 1) === 0) for (let k = 0; k < 6; k++) set(bits, trail + k, b)
      }
      return bits
    }
  }

  if (id === 'rain') {
    const drops = Array.from({ length: across }, () => ({ y: Math.random() * along, v: 0.5 + Math.random() * 1.5 }))
    return () => {
      const bits = new Uint8Array(w * h)
      drops.forEach((d, b) => {
        d.y = (d.y + d.v) % (along + 8)
        for (let k = 0; k < 6; k++) if ((b + k) % 2 === 0 || k < 2) set(bits, Math.floor(d.y) - k, b)
      })
      return bits
    }
  }

  if (id === 'marquee') {
    // Se dibuja en canvas cada cuadro para que las letras queden derechas en cualquier orientacion
    const { ctx } = blankCanvas(w, h)
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'top'
    if (w >= h) {
      const msg = '   KEYBOARDLAB · SOFLE CHOC · NICE!NANO   '
      ctx.font = 'bold 20px monospace'
      const tw = Math.ceil(ctx.measureText(msg).width)
      return (f) => {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#fff'
        ctx.fillText(msg, -((f * 3) % tw), 7)
        ctx.fillText(msg, tw - ((f * 3) % tw), 7)
        return canvasToBits(ctx, w, h)
      }
    }
    const lines = ['KEY', 'BOARD', 'LAB', '', 'SOFLE', 'CHOC', '', 'NICE', 'NANO', '']
    ctx.font = 'bold 9px monospace'
    const lh = 12
    const total = lines.length * lh
    return (f) => {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      const off = (f * 2) % total
      for (let rep = 0; rep < 2 + Math.ceil(h / total); rep++) {
        lines.forEach((l, i) => {
          const y = rep * total + i * lh - off
          if (y > -lh && y < h) ctx.fillText(l, Math.max(0, Math.floor((w - ctx.measureText(l).width) / 2)), y)
        })
      }
      return canvasToBits(ctx, w, h)
    }
  }

  if (id === 'eq') {
    const bars = 16
    const vals = new Float32Array(bars)
    return (f) => {
      const bits = new Uint8Array(w * h)
      const bw = Math.floor(along / bars)
      for (let i = 0; i < bars; i++) {
        const target = (Math.sin(f * 0.15 + i * 0.7) * 0.5 + 0.5) * (0.4 + 0.6 * Math.random())
        vals[i] += (target - vals[i]) * 0.35
        const hgt = Math.round(vals[i] * across)
        for (let a = i * bw; a < i * bw + bw - 1; a++) for (let b = across - hgt; b < across; b++) set(bits, a, b)
      }
      return bits
    }
  }

  // Juego de la vida de Conway sobre el lienzo completo
  let cells = new Uint8Array(w * h).map(() => (Math.random() < 0.3 ? 1 : 0))
  return (f) => {
    if (f % 40 === 0 && f > 0) cells = cells.map(() => (Math.random() < 0.3 ? 1 : 0))
    const next = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let n = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) if (dx || dy) n += cells[((y + dy + h) % h) * w + ((x + dx + w) % w)]
        const alive = cells[y * w + x]
        next[y * w + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0
      }
    }
    cells = next
    return cells
  }
}

export function patternBits(kind: 'fill' | 'checker' | 'border' | 'clear', o: Orientation): Uint8Array {
  const [w, h] = virtualSize(o)
  const bits = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      bits[y * w + x] =
        kind === 'fill' ? 1 : kind === 'checker' ? (x + y) % 2 : kind === 'border' ? (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 1 : 0) : 0
    }
  }
  return bits
}
