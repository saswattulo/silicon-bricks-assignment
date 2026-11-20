// Planar geometry in a local metric frame (metres, x = east, y = north).
// All regulatory distances are computed here, never in lon/lat.
import ClipperLib from 'clipper-lib'

export type Pt = [number, number]
export type Ring = Pt[] // open ring (first point not repeated)
export type Poly = Ring[] // [outer, ...holes]
export type MultiPoly = Poly[]

const EPS = 1e-9

export function openRing(r: Pt[]): Ring {
  if (r.length > 1) {
    const a = r[0]
    const b = r[r.length - 1]
    if (Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS) return r.slice(0, -1)
  }
  return r.slice()
}

export function closeRing(r: Ring): Pt[] {
  return [...r, r[0]]
}

export function signedArea(r: Ring): number {
  let s = 0
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]
    const [x2, y2] = r[(i + 1) % r.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

export function ensureCCW(r: Ring): Ring {
  return signedArea(r) < 0 ? r.slice().reverse() : r.slice()
}

export function polyArea(p: Poly): number {
  if (!p.length) return 0
  let a = Math.abs(signedArea(p[0]))
  for (let i = 1; i < p.length; i++) a -= Math.abs(signedArea(p[i]))
  return a
}

export function mpArea(mp: MultiPoly): number {
  return mp.reduce((s, p) => s + polyArea(p), 0)
}

export function perimeter(r: Ring): number {
  let s = 0
  for (let i = 0; i < r.length; i++) s += dist(r[i], r[(i + 1) % r.length])
  return s
}

export function mpPerimeter(mp: MultiPoly): number {
  let s = 0
  for (const p of mp) for (const r of p) s += perimeter(r)
  return s
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** Distance from p to segment ab. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  if (l2 < EPS) return dist(p, a)
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Inward unit normal of edge a->b for a CCW ring. */
export function inwardNormal(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l = Math.hypot(dx, dy) || 1
  return [-dy / l, dx / l]
}

/** Signed distance of p from the infinite line through a->b, positive on the inward (left) side. */
export function signedDistToLine(p: Pt, a: Pt, b: Pt): number {
  const n = inwardNormal(a, b)
  return (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1]
}

/** A polygon approximating all points within d of segment ab (a "stadium"). */
export function capsule(a: Pt, b: Pt, d: number, arcSeg = 10): Ring {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
  const pts: Ring = []
  // semicircle around b from ang-90 to ang+90, then around a from ang+90 to ang+270
  for (let i = 0; i <= arcSeg; i++) {
    const t = ang - Math.PI / 2 + (Math.PI * i) / arcSeg
    pts.push([b[0] + d * Math.cos(t), b[1] + d * Math.sin(t)])
  }
  for (let i = 0; i <= arcSeg; i++) {
    const t = ang + Math.PI / 2 + (Math.PI * i) / arcSeg
    pts.push([a[0] + d * Math.cos(t), a[1] + d * Math.sin(t)])
  }
  return pts
}

const SCALE = 1000 // millimetre integer grid for robust booleans

type IP = { X: number; Y: number }

function ringToPath(r: Ring, wantPositive: boolean): IP[] {
  const path = r.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }))
  const pos = signedArea(r) > 0
  return pos === wantPositive ? path : path.reverse()
}

function toPaths(mp: MultiPoly): IP[][] {
  const out: IP[][] = []
  for (const p of mp) p.forEach((r, i) => out.push(ringToPath(r, i === 0)))
  return out
}

function pathToRing(path: IP[]): Ring {
  return path.map((q) => [q.X / SCALE, q.Y / SCALE] as Pt)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromTree(tree: any): MultiPoly {
  const out: MultiPoly = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visitOuter = (node: any) => {
    const outer = ensureCCW(pathToRing(node.Contour()))
    const holes: Ring[] = []
    for (const h of node.Childs()) {
      const hr = pathToRing(h.Contour())
      holes.push(signedArea(hr) > 0 ? hr.reverse() : hr)
      for (const island of h.Childs()) visitOuter(island)
    }
    if (outer.length >= 3) out.push([outer, ...holes.filter((h) => h.length >= 3)])
  }
  for (const n of tree.Childs()) visitOuter(n)
  return out
}

function clip(type: number, subj: IP[][], clipP: IP[][]): MultiPoly {
  const c = new ClipperLib.Clipper()
  c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true)
  if (clipP.length) c.AddPaths(clipP, ClipperLib.PolyType.ptClip, true)
  const tree = new ClipperLib.PolyTree()
  c.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  return fromTree(tree)
}

export function union(...mps: MultiPoly[]): MultiPoly {
  const xs = mps.filter((m) => m.length)
  if (!xs.length) return []
  return clip(ClipperLib.ClipType.ctUnion, xs.flatMap(toPaths), [])
}

export function intersection(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (!a.length || !b.length) return []
  return clip(ClipperLib.ClipType.ctIntersection, toPaths(a), toPaths(b))
}

export function difference(a: MultiPoly, ...bs: MultiPoly[]): MultiPoly {
  const xs = bs.filter((m) => m.length)
  if (!a.length) return []
  if (!xs.length) return a
  return clip(ClipperLib.ClipType.ctDifference, toPaths(a), xs.flatMap(toPaths))
}

/**
 * Region of `plot` at least d_i away from each edge i (d_i = setbacks[i]).
 * Exact "distance from boundary" semantics for any simple polygon, convex or not.
 */
export function insetByEdges(plot: Ring, setbacks: number[]): MultiPoly {
  const caps: MultiPoly = []
  for (let i = 0; i < plot.length; i++) {
    const d = setbacks[i]
    if (d > 0.001) caps.push([capsule(plot[i], plot[(i + 1) % plot.length], d, 16)])
  }
  const base: MultiPoly = [[ensureCCW(plot)]]
  if (!caps.length) return base
  return clean(difference(base, caps))
}

/** Uniform inset of a multipolygon by d (mitred corners: a design move, not a legal distance). */
export function insetMP(mp: MultiPoly, d: number): MultiPoly {
  if (d <= 0 || !mp.length) return mp
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE)
  co.AddPaths(toPaths(mp), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon)
  const tree = new ClipperLib.PolyTree()
  co.Execute(tree, -d * SCALE)
  return clean(fromTree(tree))
}

/** Keep the part of mp where signedDistToLine(p, a, b) >= minD (half-plane clip). */
export function clipHalfPlane(mp: MultiPoly, a: Pt, b: Pt, minD: number, big = 1e5): MultiPoly {
  if (!mp.length) return []
  const n = inwardNormal(a, b)
  const t: Pt = [(b[0] - a[0]) / (dist(a, b) || 1), (b[1] - a[1]) / (dist(a, b) || 1)]
  const o: Pt = [a[0] + n[0] * minD, a[1] + n[1] * minD]
  const rect: Ring = [
    [o[0] - t[0] * big, o[1] - t[1] * big],
    [o[0] + t[0] * big, o[1] + t[1] * big],
    [o[0] + t[0] * big + n[0] * big, o[1] + t[1] * big + n[1] * big],
    [o[0] - t[0] * big + n[0] * big, o[1] - t[1] * big + n[1] * big],
  ]
  return clean(intersection(mp, [[rect]]))
}

/** Drop slivers produced by boolean ops. */
export function clean(mp: MultiPoly, minArea = 0.5): MultiPoly {
  return mp
    .map((p) => {
      const outer = p[0]
      if (!outer || Math.abs(signedArea(outer)) < minArea) return null
      const holes = p.slice(1).filter((h) => Math.abs(signedArea(h)) >= minArea)
      return [outer, ...holes] as Poly
    })
    .filter((p): p is Poly => !!p)
}

export function centroid(r: Ring): Pt {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]
    const [x2, y2] = r[(i + 1) % r.length]
    const f = x1 * y2 - x2 * y1
    a += f
    cx += (x1 + x2) * f
    cy += (y1 + y2) * f
  }
  if (Math.abs(a) < EPS) return r[0]
  return [cx / (3 * a), cy / (3 * a)]
}

/** Does segment p1p2 intersect segment p3p4 (proper or touching)? */
function segIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** True if the ring has any self-intersection between non-adjacent edges. */
export function isSelfIntersecting(r: Ring): boolean {
  const n = r.length
  for (let i = 0; i < n; i++) {
    const a1 = r[i]
    const a2 = r[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue
      if (segIntersect(a1, a2, r[j], r[(j + 1) % n])) return true
    }
  }
  return false
}

export function pointInRing(p: Pt, r: Ring): boolean {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]
    const [xj, yj] = r[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-300) + xi) inside = !inside
  }
  return inside
}

export function pointInMP(p: Pt, mp: MultiPoly): boolean {
  for (const poly of mp) {
    if (!pointInRing(p, poly[0])) continue
    if (poly.slice(1).some((h) => pointInRing(p, h))) continue
    return true
  }
  return false
}

/** Minimum distance between point and the boundary of a multipolygon. */
export function distToMPBoundary(p: Pt, mp: MultiPoly): number {
  let m = Infinity
  for (const poly of mp)
    for (const r of poly) for (let i = 0; i < r.length; i++) m = Math.min(m, distToSegment(p, r[i], r[(i + 1) % r.length]))
  return m
}

/** Smallest distance between two rings' boundaries (0 if they cross). */
export function ringDistance(a: Ring, b: Ring): number {
  let m = Infinity
  for (const p of a) for (let i = 0; i < b.length; i++) m = Math.min(m, distToSegment(p, b[i], b[(i + 1) % b.length]))
  for (const p of b) for (let i = 0; i < a.length; i++) m = Math.min(m, distToSegment(p, a[i], a[(i + 1) % a.length]))
  return m
}

/** Rotate point around origin. */
export function rot(p: Pt, ang: number): Pt {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]
}

export function bbox(mp: MultiPoly): [number, number, number, number] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of mp)
    for (const r of p)
      for (const [x, y] of r) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
  return [x0, y0, x1, y1]
}
