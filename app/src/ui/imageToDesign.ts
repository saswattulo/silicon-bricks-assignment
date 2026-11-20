// Read a building picture in the browser (no upload, no AI service) and draft a design from it.
//  - Plan or sketch (top view): trace the footprint. Circles, ellipses and rectangles are
//    recognised; anything else becomes a traced outline.
//  - Photo or elevation (side view): read proportions, floor count (from the rhythm of window
//    rows), taper, and a wider podium at the base. The plan shape cannot be seen from the side,
//    so the user picks it.
import type { Design, DesignShape } from '../rules/engine'
import type { Pt } from '../geo/geom'

export interface Pixels {
  width: number
  height: number
  data: Uint8ClampedArray | number[] // RGBA
}

export interface Reading {
  mode: 'plan' | 'side'
  mask: Uint8Array
  width: number
  height: number
  bbox: [number, number, number, number] // x0, y0, x1, y1 (inclusive)
  outline?: Pt[] // image pixels, for the preview
  draft: Partial<Design>
  notes: string[]
  ok: boolean
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

/** Foreground (building) mask: pixels that differ from the border colour, largest blob, holes filled. */
export function foreground(px: Pixels, rowBg = false): { mask: Uint8Array; bbox: [number, number, number, number]; area: number } {
  const { width: W, height: H, data } = px
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const push = (x: number, y: number) => {
    const i = (y * W + x) * 4
    rs.push(data[i])
    gs.push(data[i + 1])
    bs.push(data[i + 2])
  }
  for (let x = 0; x < W; x++) {
    push(x, 0)
    push(x, H - 1)
  }
  for (let y = 0; y < H; y++) {
    push(0, y)
    push(W - 1, y)
  }
  const bg = [median(rs), median(gs), median(bs)]
  // Photos: sky changes colour with height and the ground fills the bottom, so compare each
  // pixel with the edges of its own row instead of one colour for the whole picture.
  const rowCol: number[][] = []
  if (rowBg) {
    const k = Math.max(2, Math.round(W * 0.03))
    for (let y = 0; y < H; y++) {
      const r: number[] = []
      const g: number[] = []
      const b: number[] = []
      for (const x of [...Array(k).keys(), ...Array.from({ length: k }, (_, j) => W - 1 - j)]) {
        const i = (y * W + x) * 4
        r.push(data[i])
        g.push(data[i + 1])
        b.push(data[i + 2])
      }
      rowCol.push([median(r), median(g), median(b)])
    }
  }
  const dist = new Float32Array(W * H)
  const hist = new Array(256).fill(0)
  for (let i = 0; i < W * H; i++) {
    const c = rowBg ? rowCol[Math.floor(i / W)] : bg
    const d = Math.hypot(data[i * 4] - c[0], data[i * 4 + 1] - c[1], data[i * 4 + 2] - c[2]) / 1.733
    dist[i] = d
    hist[Math.min(255, Math.floor(d))]++
  }
  // Otsu threshold on colour distance, never below 22 so paper texture stays background
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sB = 0
  let wB = 0
  let best = 0
  let thr = 40
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = W * H - wB
    if (!wF) break
    sB += t * hist[t]
    const mB = sB / wB
    const mF = (sum - sB) / wF
    const v = wB * wF * (mB - mF) * (mB - mF)
    if (v > best) {
      best = v
      thr = t
    }
  }
  thr = Math.max(22, thr)
  let m = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) m[i] = dist[i] > thr ? 1 : 0
  // close small gaps (window mullions, sketch line breaks): dilate twice, erode twice
  const morph = (src: Uint8Array, grow: boolean) => {
    const out = new Uint8Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = grow ? 0 : 1
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            const s = xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : src[yy * W + xx]
            if (grow && s) v = 1
            if (!grow && !s) v = 0
          }
        out[y * W + x] = v
      }
    return out
  }
  m = morph(morph(m, true), true)
  m = morph(morph(m, false), false)
  if (rowBg) {
    // Glass often reflects the sky, so floors can read as stripes: close vertical gaps up to ~4%
    // of the picture height to keep the building in one piece.
    const r = Math.max(2, Math.round(H * 0.04))
    const vclose = (src: Uint8Array) => {
      const dil = new Uint8Array(W * H)
      for (let x = 0; x < W; x++) {
        let last = -1e9
        for (let y = 0; y < H; y++) {
          if (src[y * W + x]) last = y
          if (y - last <= r) dil[y * W + x] = 1
        }
        last = 1e9
        for (let y = H - 1; y >= 0; y--) {
          if (src[y * W + x]) last = y
          if (last - y <= r) dil[y * W + x] = 1
        }
      }
      const ero = new Uint8Array(W * H)
      for (let x = 0; x < W; x++) {
        let lastOff = -1e9
        const near = new Int32Array(H).fill(1e9)
        for (let y = 0; y < H; y++) {
          if (!dil[y * W + x]) lastOff = y
          near[y] = y - lastOff
        }
        lastOff = 1e9
        for (let y = H - 1; y >= 0; y--) {
          if (!dil[y * W + x]) lastOff = y
          near[y] = Math.min(near[y], lastOff - y)
          ero[y * W + x] = near[y] > r ? 1 : 0
        }
      }
      return ero
    }
    m = vclose(m)
  }
  // largest 4-connected component
  const lab = new Int32Array(W * H)
  let bestLab = 0
  let bestN = 0
  let cur = 0
  const stack: number[] = []
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || lab[i]) continue
    cur++
    let n = 0
    stack.push(i)
    lab[i] = cur
    while (stack.length) {
      const j = stack.pop()!
      n++
      const x = j % W
      const y = (j - x) / W
      for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1])
        if (k >= 0 && m[k] && !lab[k]) {
          lab[k] = cur
          stack.push(k)
        }
    }
    if (n > bestN) {
      bestN = n
      bestLab = cur
    }
  }
  // fill holes: everything not reachable from the border through non-building pixels is building
  const out = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) out[i] = lab[i] === bestLab && bestLab ? 1 : 0
  const outside = new Uint8Array(W * H)
  for (let x = 0; x < W; x++)
    for (const y of [0, H - 1]) {
      const i = y * W + x
      if (!out[i] && !outside[i]) {
        outside[i] = 1
        stack.push(i)
      }
    }
  for (let y = 0; y < H; y++)
    for (const x of [0, W - 1]) {
      const i = y * W + x
      if (!out[i] && !outside[i]) {
        outside[i] = 1
        stack.push(i)
      }
    }
  while (stack.length) {
    const j = stack.pop()!
    const x = j % W
    const y = (j - x) / W
    for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1])
      if (k >= 0 && !out[k] && !outside[k]) {
        outside[k] = 1
        stack.push(k)
      }
  }
  let area = 0
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (!outside[i]) out[i] = 1
      if (out[i]) {
        area++
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  return { mask: out, bbox: [x0, y0, x1, y1], area }
}

/** Boundary of the mask as a polygon (Moore neighbour tracing), in pixel coordinates. */
function trace(mask: Uint8Array, W: number, H: number): Pt[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1
  let sx = -1
  let sy = -1
  outer: for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (at(x, y)) {
        sx = x
        sy = y
        break outer
      }
  if (sx < 0) return []
  const dirs: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
  const pts: Pt[] = [[sx, sy]]
  let cx = sx
  let cy = sy
  let d = 6 // came from the left/top
  for (let guard = 0; guard < W * H * 2; guard++) {
    let found = false
    for (let k = 0; k < 8; k++) {
      const nd = (d + 6 + k) % 8 // start looking back-left of the last move
      const nx = cx + dirs[nd][0]
      const ny = cy + dirs[nd][1]
      if (at(nx, ny)) {
        cx = nx
        cy = ny
        d = nd
        found = true
        break
      }
    }
    if (!found) break
    if (cx === sx && cy === sy) break
    pts.push([cx, cy])
  }
  return pts
}

/** Douglas-Peucker on a closed ring. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 4) return pts
  // split at the point farthest from the first so the ring is two open polylines
  let far = 0
  let fd = -1
  for (let i = 1; i < pts.length; i++) {
    const dd = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1])
    if (dd > fd) {
      fd = dd
      far = i
    }
  }
  const dp = (a: Pt[]): Pt[] => {
    if (a.length < 3) return a
    const [p, q] = [a[0], a[a.length - 1]]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    let idx = 0
    let dm = 0
    for (let i = 1; i < a.length - 1; i++) {
      const dd = Math.abs((q[0] - p[0]) * (p[1] - a[i][1]) - (p[0] - a[i][0]) * (q[1] - p[1])) / L
      if (dd > dm) {
        dm = dd
        idx = i
      }
    }
    if (dm <= eps) return [p, q]
    const l = dp(a.slice(0, idx + 1))
    return [...l.slice(0, -1), ...dp(a.slice(idx))]
  }
  const A = dp(pts.slice(0, far + 1))
  const B = dp([...pts.slice(far), pts[0]])
  return [...A.slice(0, -1), ...B.slice(0, -1)]
}

export function readPlan(px: Pixels, widthM: number): Reading {
  const { mask, bbox, area } = foreground(px)
  const W = px.width
  const [x0, y0, x1, y1] = bbox
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const notes: string[] = []
  if (area < 50 || bw < 8 || bh < 8 || area > 0.97 * W * px.height)
    return { mode: 'plan', mask, width: W, height: px.height, bbox, draft: {}, notes: ['Could not find a building outline. Try a plan or sketch with a plain background.'], ok: false }
  // how well an inscribed ellipse explains the blob
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const rx = bw / 2
  const ry = bh / 2
  let inE = 0
  let eArea = 0
  let maskInE = 0
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const e = ((x + 0.5 - cx - 0.5) / rx) ** 2 + ((y + 0.5 - cy - 0.5) / ry) ** 2 <= 1
      if (e) {
        eArea++
        if (mask[y * W + x]) maskInE++
      }
      if (mask[y * W + x] && e) inE++
    }
  const fillBox = area / (bw * bh)
  const insideE = inE / area
  const coverE = maskInE / Math.max(1, eArea)
  const aspect = bh / bw
  const depthM = widthM * aspect
  let shape: DesignShape
  let outline: Pt[] | undefined
  const ring = trace(mask, W, px.height)
  const simp = simplify(ring, Math.max(1.2, 0.015 * Math.max(bw, bh)))
  if (insideE > 0.96 && coverE > 0.93 && fillBox < 0.86) {
    shape = Math.abs(aspect - 1) < 0.1 ? 'circle' : 'ellipse'
    notes.push(`Recognised a ${shape} (${Math.round(coverE * 100)}% match).`)
  } else if (fillBox > 0.94) {
    shape = 'rect'
    notes.push(`Recognised a rectangle (${Math.round(fillBox * 100)}% of its box).`)
  } else {
    shape = 'custom'
    outline = simp.map(([x, y]) => [(x - cx) / bw, -(y - cy) / bh] as Pt)
    notes.push(`Traced the outline: ${simp.length} corners.`)
  }
  notes.push(`Proportions ${fmt1(widthM)} × ${fmt1(depthM)} m from the width you gave.`)
  return {
    mode: 'plan',
    mask,
    width: W,
    height: px.height,
    bbox,
    outline: simp,
    draft: { shape, width: round1(widthM), depth: round1(shape === 'circle' ? widthM : depthM), outline, rotation: 0 },
    notes,
    ok: true,
  }
}

export function readSide(px: Pixels, widthM: number, floorH: number): Reading {
  const { mask, bbox, area } = foreground(px, true)
  const { width: W, height: H, data } = px
  const [x0, y0, x1, y1] = bbox
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  if (area < 50 || bw < 6 || bh < 12 || area > 0.97 * W * H)
    return { mode: 'side', mask, width: W, height: H, bbox, draft: {}, notes: ['Could not find the building against the sky. Try a photo with plain sky behind it.'], ok: false }
  const notes: string[] = []
  // width of the silhouette per row
  const rowW: number[] = []
  for (let y = y0; y <= y1; y++) {
    let n = 0
    for (let x = x0; x <= x1; x++) n += mask[y * W + x]
    rowW.push(n)
  }
  const avg = (a: number, b: number) => {
    const s = rowW.slice(Math.floor(a * bh), Math.max(Math.floor(a * bh) + 1, Math.floor(b * bh)))
    return s.reduce((p, q) => p + q, 0) / s.length
  }
  // podium: base clearly wider than the shaft above it
  const shaftW = median(rowW.slice(Math.floor(0.25 * bh), Math.floor(0.75 * bh)))
  let podRows = 0
  for (let k = bh - 1; k >= 0 && rowW[k] > shaftW * 1.25; k--) podRows++
  const podFrac = podRows / bh < 0.4 && podRows / bh > 0.03 ? podRows / bh : 0
  const top = avg(0.05, 0.2)
  const bottom = podFrac ? shaftW : avg(0.6, 0.85)
  const taper = Math.max(0, Math.min(60, Math.round((1 - top / Math.max(1, bottom)) * 100)))
  // floor rhythm: horizontal edge energy per row inside the silhouette, then autocorrelation
  const gray = (x: number, y: number) => {
    const i = (y * W + x) * 4
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  const e: number[] = []
  for (let y = y0; y < y1; y++) {
    let s = 0
    let n = 0
    for (let x = x0; x <= x1; x++)
      if (mask[y * W + x] && mask[(y + 1) * W + x]) {
        s += Math.abs(gray(x, y + 1) - gray(x, y))
        n++
      }
    e.push(n ? s / n : 0)
  }
  const win = Math.max(3, Math.round(bh / 12))
  const det = e.map((v, i) => {
    const a = e.slice(Math.max(0, i - win), i + win + 1)
    return v - a.reduce((p, q) => p + q, 0) / a.length
  })
  const v0 = det.reduce((p, q) => p + q * q, 0) || 1
  let bestLag = 0
  let bestR = 0
  for (let lag = Math.max(3, Math.floor(bh / 150)); lag <= Math.floor(bh / 4); lag++) {
    let s = 0
    for (let i = 0; i + lag < det.length; i++) s += det[i] * det[i + lag]
    const r = (s / v0) * (det.length / (det.length - lag))
    if (r > bestR + 0.02) {
      bestR = r
      bestLag = lag
    }
  }
  const aspect = bh / bw
  const heightM = aspect * (podFrac ? widthM * (bw / Math.max(1, shaftW)) : widthM)
  let floors: number
  if (bestLag && bestR > 0.3) {
    floors = Math.max(1, Math.round(bh / bestLag))
    notes.push(`Counted about ${floors} floors from the rows of windows.`)
  } else {
    floors = Math.max(1, Math.round(heightM / floorH))
    notes.push(`No clear window rows, so floors are estimated from the height: about ${fmt1(heightM)} m.`)
  }
  const podiumFloors = podFrac ? Math.min(10, Math.max(1, Math.round(floors * podFrac))) : 0
  if (podiumFloors) notes.push(`The base is wider: read as a ${podiumFloors}-floor podium.`)
  if (taper >= 5) notes.push(`The top is ${taper}% narrower than the base: read as a taper.`)
  notes.push('A side view does not show the plan shape, so pick it below.')
  return {
    mode: 'side',
    mask,
    width: W,
    height: H,
    bbox,
    outline: trace(mask, W, H),
    draft: { width: round1(widthM), depth: round1(widthM), towerFloors: Math.max(1, floors - podiumFloors), podiumFloors, podiumFill: podiumFloors > 0, taper: taper >= 5 ? taper : 0 },
    notes,
    ok: true,
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10
const fmt1 = (x: number) => (Math.round(x * 10) / 10).toString()
