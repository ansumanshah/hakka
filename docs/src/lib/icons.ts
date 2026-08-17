/**
 * NoodleApps Icon Drawing Library — v6 (ES Module)
 * All pixel values relative to canvas size via s = w/64
 */

// roundRect is a standard Canvas2D API (Chrome 99+, Firefox 112+, Safari 15.4+)
declare global {
  interface CanvasRenderingContext2D {
    roundRect(x: number, y: number, w: number, h: number, radii?: number | number[]): void
  }
}

type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number, p: number, st: IconState) => void

interface Bubble {
  x: number
  y: number
  vy: number
  baseR: number
  opacity: number
}

interface SteamParticle {
  life: number
  speed: number
  drift: number
  size: number
}

interface NoodleSteamParticle {
  life: number
  speed: number
  offset: number
}

interface TiltState {
  tiltX: number
  tiltY: number
  hovered: boolean
  _curX: number
  _curY: number
}

interface CanvasEntry {
  id: string
  canvas: HTMLCanvasElement
  draw: DrawFn
}

export interface IconState {
  entryFrame: number
  bubbles: Bubble[]
  steamParticles: Record<string, SteamParticle[][]>
  noodleSteam: Record<string, NoodleSteamParticle[]>
}

const state: Record<string, IconState> = {}
const tilts: Record<string, TiltState> = {}
let canvases: CanvasEntry[] = []
let running = false
let frame = 0

const getDPR = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 2

function getState(id: string): IconState {
  if (!state[id]) {
    state[id] = {
      entryFrame: 0,
      bubbles: initBubbles(),
      steamParticles: {},
      noodleSteam: {},
    }
  }
  return state[id]
}

function initBubbles(): Bubble[] {
  const bubs: Bubble[] = []
  for (let i = 0; i < 6; i++) {
    bubs.push({
      x: 0.3 + Math.random() * 0.4,
      y: 0.48 - Math.random() * 0.12,
      vy: 0.003 + Math.random() * 0.003,
      baseR: 1.5 + Math.random() * 1.5,
      opacity: Math.random(),
    })
  }
  return bubs
}

export function register(id: string, drawFn: DrawFn) {
  if (typeof document === 'undefined') return
  const c = document.getElementById(id) as HTMLCanvasElement
  if (!c) return

  tilts[id] = { tiltX: 0, tiltY: 0, hovered: false, _curX: 0, _curY: 0 }
  canvases.push({ id, canvas: c, draw: drawFn })
  getState(id)

  c.addEventListener('mouseenter', () => {
    tilts[id].hovered = true
  })
  c.addEventListener('mouseleave', () => {
    tilts[id].hovered = false
  })
  c.addEventListener('mousemove', (e) => {
    const r = c.getBoundingClientRect()
    const dpr = getDPR()
    const cssW = c.width / dpr,
      cssH = c.height / dpr
    const nx = (e.clientX - r.left) / cssW - 0.5
    const ny = (e.clientY - r.top) / cssH - 0.5
    tilts[id].tiltX = ny * 18
    tilts[id].tiltY = -nx * 18
  })

  if (!running) {
    running = true
    tick()
  }
}

function setup(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!
  const dpr = getDPR()
  const cssW = canvas.width / dpr
  const cssH = canvas.height / dpr
  canvas.style.width = cssW + 'px'
  canvas.style.height = cssH + 'px'
  canvas.width = canvas.width // Clear/Reset
  canvas.height = canvas.height
  ctx.scale(dpr, dpr)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { ctx, w: cssW, h: cssH }
}

function tick() {
  frame++
  const p = frame * 0.025
  for (let i = 0; i < canvases.length; i++) {
    const entry = canvases[i]
    const s = setup(entry.canvas)
    const st = getState(entry.id)
    const tilt = tilts[entry.id] || { tiltX: 0, tiltY: 0, hovered: false }

    const targetX = tilt.hovered ? tilt.tiltX : 0
    const targetY = tilt.hovered ? tilt.tiltY : 0
    tilt._curX += (targetX - tilt._curX) * 0.12
    tilt._curY += (targetY - tilt._curY) * 0.12

    s.ctx.clearRect(0, 0, s.w, s.h)

    const entryProg = Math.min(1, st.entryFrame / 30)
    st.entryFrame++

    const tx = tilt._curX,
      ty = tilt._curY
    const scale = entryProg < 1 ? 0.5 + 0.5 * entryProg : 1
    entry.canvas.style.transform = `perspective(400px) rotateX(${tx}deg) rotateY(${ty}deg) scale(${scale})`
    entry.canvas.style.transformOrigin = 'center center'
    entry.canvas.style.transition = tilt.hovered ? 'none' : 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)'

    entry.draw(s.ctx, s.w, s.h, p, st)
  }
  requestAnimationFrame(tick)
}

// ── Shared bowl primitives ──

// Flat top-down oval bowl (the original v6 look — a glossy dish, not a 3D bowl).
const BOWL = { xFrac: 0.12, yFrac: 0.4, wFrac: 0.76, hFrac: 0.625 }

function bowlRect(w: number, h: number) {
  return { x: w * BOWL.xFrac, y: h * BOWL.yFrac, w: w * BOWL.wFrac, h: w * 0.44 }
}

function bowlClipPath(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const b = bowlRect(w, h)
  ctx.beginPath()
  ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
}

function bowl(ctx: CanvasRenderingContext2D, w: number, h: number, c1: string, c2: string) {
  const b = bowlRect(w, h)
  const rimY = h * 0.42,
    baseY = b.y + b.h
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, h * 0.415, w, h)
  ctx.clip()
  bowlClipPath(ctx, w, h)
  ctx.clip()
  const grad = ctx.createLinearGradient(w * 0.5, rimY, w * 0.5, baseY)
  grad.addColorStop(0, c1)
  grad.addColorStop(0.55, c2)
  grad.addColorStop(1, c2)
  ctx.fillStyle = grad
  ctx.fillRect(0, rimY, w, baseY - rimY + 4)

  const specX = w * 0.24
  const spec = ctx.createRadialGradient(
    specX,
    rimY + (baseY - rimY) * 0.15,
    0,
    specX,
    rimY + (baseY - rimY) * 0.28,
    w * 0.22,
  )
  spec.addColorStop(0, 'rgba(255,255,255,0.22)')
  spec.addColorStop(0.5, 'rgba(255,255,255,0.08)')
  spec.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = spec
  ctx.fillRect(0, rimY, w, baseY - rimY + 4)

  const specR = w * 0.74
  const rSpec = ctx.createRadialGradient(
    specR,
    rimY + (baseY - rimY) * 0.22,
    0,
    specR,
    rimY + (baseY - rimY) * 0.35,
    w * 0.16,
  )
  rSpec.addColorStop(0, 'rgba(255,255,255,0.10)')
  rSpec.addColorStop(0.6, 'rgba(255,255,255,0.03)')
  rSpec.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = rSpec
  ctx.fillRect(0, rimY, w, baseY - rimY + 4)

  const bot = ctx.createLinearGradient(w * 0.5, rimY + (baseY - rimY) * 0.6, w * 0.5, baseY)
  bot.addColorStop(0, 'rgba(0,0,0,0)')
  bot.addColorStop(1, 'rgba(0,0,0,0.32)')
  ctx.fillStyle = bot
  ctx.fillRect(0, rimY, w, baseY - rimY + 4)
  ctx.restore()
}

function bowlDepth(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sR: number,
  sG: number,
  sB: number,
  hR: number,
  hG: number,
  hB: number,
) {
  const b = bowlRect(w, h)
  const rimY = h * 0.42,
    baseY = b.y + b.h
  const midY = rimY + (baseY - rimY) * 0.5
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, h * 0.415, w, h)
  ctx.clip()
  bowlClipPath(ctx, w, h)
  ctx.clip()
  const sh = ctx.createRadialGradient(w * 0.5, midY + (baseY - rimY) * 0.2, w * 0.04, w * 0.5, midY, w * 0.38)
  sh.addColorStop(0, `rgba(${sR},${sG},${sB},0.45)`)
  sh.addColorStop(0.5, `rgba(${sR},${sG},${sB},0.15)`)
  sh.addColorStop(1, `rgba(${sR},${sG},${sB},0)`)
  ctx.fillStyle = sh
  ctx.fillRect(0, rimY, w, baseY - rimY + 10)
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, h * 0.415, w, h)
  ctx.clip()
  bowlClipPath(ctx, w, h)
  ctx.clip()
  const hlY = rimY + (baseY - rimY) * 0.2
  const hl = ctx.createRadialGradient(w * 0.45, hlY, w * 0.02, w * 0.45, hlY, w * 0.28)
  hl.addColorStop(0, `rgba(${hR},${hG},${hB},0.35)`)
  hl.addColorStop(0.4, `rgba(${hR},${hG},${hB},0.12)`)
  hl.addColorStop(1, `rgba(${hR},${hG},${hB},0)`)
  ctx.fillStyle = hl
  ctx.beginPath()
  ctx.ellipse(w * 0.45, hlY, w * 0.28, (baseY - rimY) * 0.11, -0.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function parseColor(color: string) {
  const m = color.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/)
  if (!m) return { r: 200, g: 200, b: 200, a: 1 }
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 }
}

function rimRgba(c: { r: number; g: number; b: number; a: number }, alpha: number) {
  return `rgba(${c.r},${c.g},${c.b},${(c.a * alpha).toFixed(2)})`
}

function rim(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, p: number) {
  const s = w / 64
  const rimScale = p !== undefined ? 1 + 0.012 * Math.sin(p * 0.8) : 1
  const rimY = h * 0.42
  const x0 = w * 0.1,
    x1 = w * 0.9
  const c = parseColor(color)

  ctx.save()
  ctx.translate(w / 2, rimY)
  ctx.scale(rimScale, 1)
  ctx.translate(-w / 2, -rimY)
  ctx.lineCap = 'round'

  ctx.beginPath()
  ctx.moveTo(x0, rimY + 2 * s)
  ctx.lineTo(x1, rimY + 2 * s)
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'
  ctx.lineWidth = 2 * s
  ctx.stroke()

  const grad = ctx.createLinearGradient(x0, rimY, x1, rimY)
  grad.addColorStop(0, rimRgba(c, 0.7))
  grad.addColorStop(0.15, rimRgba(c, 1.0))
  grad.addColorStop(0.85, rimRgba(c, 1.0))
  grad.addColorStop(1, rimRgba(c, 0.65))
  ctx.beginPath()
  ctx.moveTo(x0, rimY)
  ctx.lineTo(x1, rimY)
  ctx.strokeStyle = grad
  ctx.lineWidth = 3.2 * s
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x0 + 6 * s, rimY - 0.8 * s)
  ctx.lineTo(x1 - 6 * s, rimY - 0.8 * s)
  ctx.strokeStyle = 'rgba(255,255,255,0.40)'
  ctx.lineWidth = 0.9 * s
  ctx.stroke()
  ctx.restore()
}

function noodles(ctx: CanvasRenderingContext2D, w: number, h: number, opacity: number = 0.45) {
  const s = w / 64
  ctx.save()
  ctx.lineWidth = 1.0 * s
  ctx.lineCap = 'round'
  ctx.strokeStyle = `rgba(255,255,255,${opacity})`
  for (let i = 0; i < 2; i++) {
    const ny = h * 0.52 + i * 5 * s
    ctx.beginPath()
    ctx.moveTo(w * 0.28, ny)
    ctx.quadraticCurveTo(w * 0.5, ny + (i === 0 ? 4 : -3) * s, w * 0.72, ny)
    ctx.stroke()
  }
  ctx.restore()
}

function chopsticks(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const s = w / 64
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, w, h * 0.42)
  ctx.clip()
  ctx.lineWidth = 1.5 * s
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  ctx.moveTo(w * 0.72, h * 0.18)
  ctx.lineTo(w * 0.48, h * 0.52)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(w * 0.82, h * 0.22)
  ctx.lineTo(w * 0.52, h * 0.52)
  ctx.stroke()
  ctx.restore()
}

// ── Icon Drawing Implementations ──

export function hakka(ctx: CanvasRenderingContext2D, w: number, h: number, p: number, st: IconState) {
  const s = w / 64
  // Wok Hei — warm graphite bowl with a flame rim, jade broadcast signal
  bowl(ctx, w, h, 'rgb(238,131,32)', 'rgb(180,90,20)')
  bowlDepth(ctx, w, h, 60, 30, 10, 255, 210, 160)
  noodles(ctx, w, h)
  chopsticks(ctx, w, h)
  // broadcast fan — Hakka inspects the network, so a signal rises from the bowl
  const ox = w * 0.5,
    oy = h * 0.4
  ctx.save()
  ctx.lineCap = 'round'
  // three concentric arcs pulsing outward and up
  for (let a = 0; a < 3; a++) {
    const phase = (p * 0.7 + a * 0.34) % 1
    const r = (5.5 + phase * 15) * s
    const op = 0.95 * Math.sin(phase * Math.PI)
    ctx.beginPath()
    ctx.arc(ox, oy, r, Math.PI * 1.25, Math.PI * 1.75)
    ctx.strokeStyle = `rgba(58,169,129,${op.toFixed(2)})`
    ctx.lineWidth = 2 * s
    ctx.stroke()
  }
  // bright origin node
  const dotGlow = ctx.createRadialGradient(ox, oy, 0, ox, oy, 5 * s)
  dotGlow.addColorStop(0, 'rgba(79,220,170,0.5)')
  dotGlow.addColorStop(1, 'rgba(79,220,170,0)')
  ctx.fillStyle = dotGlow
  ctx.beginPath()
  ctx.arc(ox, oy, 5 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(190,255,225,0.98)'
  ctx.beginPath()
  ctx.arc(ox, oy, 1.9 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  rim(ctx, w, h, 'rgb(238,131,32)', p)
}
