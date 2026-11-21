// three.js geometry for the legal envelope and concept massing, rendered as a
// MapLibre custom layer so it shares the depth buffer with the real 3D city.
import * as THREE from 'three'
import earcut from 'earcut'
import type * as maplibregl from 'maplibre-gl'
import type { MultiPoly, Pt, Ring } from '../geo/geom'
import { bbox, difference, insetMP, mpArea } from '../geo/geom'
import type { LocalFrame } from '../geo/frame'
import { type Concept, type Envelope, type Floor, clipToPlane, planeHeight } from '../rules/engine'

type ZFn = (p: Pt) => number

function pushTriangles(out: number[], mp: MultiPoly, z: ZFn) {
  for (const poly of mp) {
    const flat: number[] = []
    const holes: number[] = []
    poly.forEach((r, i) => {
      if (i > 0) holes.push(flat.length / 2)
      for (const [x, y] of r) flat.push(x, y)
    })
    const idx = earcut(flat, holes.length ? holes : undefined, 2)
    for (const i of idx) {
      const p: Pt = [flat[2 * i], flat[2 * i + 1]]
      out.push(p[0], p[1], z(p))
    }
  }
}

function pushWalls(out: number[], mp: MultiPoly, z0: number, top: ZFn, splitAt?: (a: Pt, b: Pt) => Pt | null) {
  const quad = (a: Pt, b: Pt) => {
    const ha = top(a)
    const hb = top(b)
    out.push(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], hb)
    out.push(a[0], a[1], z0, b[0], b[1], hb, a[0], a[1], ha)
  }
  for (const poly of mp)
    for (const r of poly)
      for (let i = 0; i < r.length; i++) {
        const a = r[i]
        const b = r[(i + 1) % r.length]
        const m = splitAt?.(a, b)
        if (m) {
          quad(a, m)
          quad(m, b)
        } else quad(a, b)
      }
}

function geometryFrom(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.computeVertexNormals()
  return g
}

/** Solid of the legal envelope: stacked bands, each capped by the road sky plane. */
export function envelopeGeometry(env: Envelope): THREE.BufferGeometry {
  const pos: number[] = []
  const pl = env.plane
  env.bands.forEach((band, k) => {
    const R = clipToPlane(band.region, pl, band.z0)
    if (!R.length) return
    const z1 = band.z1
    const flat = clipToPlane(R, pl, z1)
    const slope = difference(R, flat)
    const next = env.bands[k + 1]
    const nextR = next ? clipToPlane(next.region, pl, z1) : []
    const flatTop = nextR.length ? difference(flat, nextR) : flat
    pushTriangles(pos, flatTop, () => z1)
    pushTriangles(pos, slope, (p) => Math.min(z1, planeHeight(pl, p)))
    // walls; split edges where the plane crosses z1 so the top polyline is exact
    const dCut = z1 / 2 - pl.width
    const sd = (p: Pt) => planeHeight(pl, p) / 2 - pl.width
    pushWalls(
      pos,
      R,
      band.z0,
      (p) => Math.min(z1, planeHeight(pl, p)),
      (a, b) => {
        const da = sd(a) - dCut
        const db = sd(b) - dCut
        if (da * db >= 0) return null
        const t = da / (da - db)
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      },
    )
  })
  return geometryFrom(pos)
}

const USE_COLOUR: Record<Floor['use'], number> = {
  residential: 0xf4efe6,
  hotel: 0xf1e3cf,
  office: 0xdbe7f2,
  lobby: 0xd9c49a,
  parking: 0x9aa3ad,
  amenity: 0xb9d7b0,
}

const hex = (s: string | undefined, fb: number) => (s && /^#[0-9a-f]{6}$/i.test(s) ? new THREE.Color(s) : new THREE.Color(fb))

/** Horizontal band of wall on every ring of mp, from z0 to z1. */
const band = (out: number[], mp: MultiPoly, z0: number, z1: number) => z1 - z0 > 0.01 && pushWalls(out, mp, z0, () => z1)

/** Vertical mullion lines every `step` m along each ring, from z0 to z1. */
function mullions(out: number[], mp: MultiPoly, z0: number, z1: number, step: number) {
  for (const poly of mp)
    for (const r of poly)
      for (let i = 0; i < r.length; i++) {
        const a = r[i]
        const b = r[(i + 1) % r.length]
        const L = Math.hypot(b[0] - a[0], b[1] - a[1])
        const n = Math.floor(L / step)
        for (let k = 0; k <= n; k++) {
          const t = n ? k / n : 0
          const x = a[0] + (b[0] - a[0]) * t
          const y = a[1] + (b[1] - a[1]) * t
          out.push(x, y, z0, x, y, z1)
        }
      }
}

function outlineAt(out: number[], mp: MultiPoly, z: number) {
  for (const poly of mp)
    for (const r of poly)
      for (let i = 0; i < r.length; i++) {
        const a = r[i]
        const b = r[(i + 1) % r.length]
        out.push(a[0], a[1], z, b[0], b[1], z)
      }
}

/**
 * Concept massing drawn as a building: slab edges, window bands with mullions, a glazed lobby,
 * open parking decks, recessed balconies on home and hotel floors, parapets and roof plant.
 * Floor plates come straight from the rules engine, so what is drawn is what was checked.
 */
export function conceptGroup(c: Concept): THREE.Group {
  const g = new THREE.Group()
  const fa = c.facade
  const buf = { wall: [] as number[], parking: [] as number[], lobby: [] as number[], glass: [] as number[], dark: [] as number[], frame: [] as number[], roof: [] as number[], plant: [] as number[], rail: [] as number[], lines: [] as number[], mull: [] as number[] }
  const mainUse = c.blocks.flatMap((b) => b.floors).find((f) => f.use !== 'lobby' && f.use !== 'parking')?.use ?? 'residential'
  const glazingFor = (use: Floor['use']) => (fa ? fa.glazing / 100 : use === 'office' ? 0.7 : use === 'hotel' ? 0.5 : 0.45)
  const balconies = fa ? fa.balconies : true
  const podiumGlass = fa ? fa.podiumGlass : true
  let lineBudget = 60000

  for (const b of c.blocks)
    b.floors.forEach((f, i) => {
      const H = f.z1 - f.z0
      const slab = Math.min(0.35, H * 0.1)
      const top = f.z1
      const next = b.floors[i + 1]
      // slab edge and floor top (roof colour where it is open to the sky)
      band(buf.frame, f.plate, top - slab, top)
      pushTriangles(buf.roof, f.plate, () => top)
      outlineAt(buf.lines, f.plate, top)
      const z0 = f.z0
      const zt = top - slab
      if (f.use === 'parking' && !(podiumGlass && fa)) {
        // open deck: solid upstand, dark opening, thin spandrel
        const open = (zt - z0) * 0.45
        const sill = (zt - z0 - open) * 0.6
        band(buf.parking, f.plate, z0, z0 + sill)
        band(buf.dark, f.plate, z0 + sill, z0 + sill + open)
        band(buf.parking, f.plate, z0 + sill + open, zt)
      } else if (f.use === 'lobby' || (f.use === 'parking' && podiumGlass)) {
        band(buf.lobby, f.plate, z0, z0 + 0.25)
        band(buf.glass, f.plate, z0 + 0.25, zt)
        if (lineBudget > 0) mullions(buf.mull, f.plate, z0 + 0.25, zt, 2.4)
      } else if (balconies && (f.use === 'residential' || f.use === 'hotel') && i > 0) {
        // recessed balcony: glass railing on the edge, glazed wall 1.4 m back
        const inner = insetMP(f.plate, 1.4)
        band(buf.rail, f.plate, z0, z0 + 1.1)
        if (inner.length) {
          band(buf.glass, inner, z0, zt)
          if (lineBudget > 0) mullions(buf.mull, inner, z0, zt, 3.2)
        } else band(buf.glass, f.plate, z0, zt)
      } else {
        const gl = glazingFor(f.use) * (zt - z0)
        const sill = (zt - z0 - gl) * 0.6
        band(buf.wall, f.plate, z0, z0 + sill)
        band(buf.glass, f.plate, z0 + sill, z0 + sill + gl)
        band(buf.wall, f.plate, z0 + sill + gl, zt)
        if (lineBudget > 0) mullions(buf.mull, f.plate, z0 + sill, z0 + sill + gl, f.use === 'office' ? 1.5 : 1.8)
      }
      lineBudget = 60000 - buf.mull.length / 6
      // roof: parapet on the part open to the sky, plant on the very top
      if (!next || next.z0 > top + 0.01) {
        band(buf.wall, f.plate, top, top + 1.0)
        outlineAt(buf.lines, f.plate, top + 1.0)
        const [x0, y0, x1, y1] = bbox(f.plate)
        const plant = insetMP(f.plate, Math.min(x1 - x0, y1 - y0) * 0.32)
        if (plant.length) {
          band(buf.plant, plant, top, top + 3)
          pushTriangles(buf.plant, plant, () => top + 3)
        }
      } else {
        const open = difference(f.plate, next.plate)
        if (mpArea(open) > 4) band(buf.rail, [[...f.plate[0]]] as MultiPoly, top, top + 1.1) // terrace railing
      }
    })

  const wallC = hex(fa?.wall, USE_COLOUR[mainUse])
  const mesh = (arr: number[], mat: THREE.Material) => arr.length && g.add(new THREE.Mesh(geometryFrom(arr), mat))
  mesh(buf.wall, new THREE.MeshLambertMaterial({ color: wallC, side: THREE.DoubleSide }))
  mesh(buf.parking, new THREE.MeshLambertMaterial({ color: USE_COLOUR.parking, side: THREE.DoubleSide }))
  mesh(buf.lobby, new THREE.MeshLambertMaterial({ color: USE_COLOUR.lobby, side: THREE.DoubleSide }))
  mesh(buf.dark, new THREE.MeshLambertMaterial({ color: 0x3d434b, side: THREE.DoubleSide }))
  mesh(buf.frame, new THREE.MeshLambertMaterial({ color: hex(fa?.frame, 0xd8d2c8), side: THREE.DoubleSide }))
  mesh(buf.roof, new THREE.MeshLambertMaterial({ color: 0xc9c4bb, side: THREE.DoubleSide }))
  mesh(buf.plant, new THREE.MeshLambertMaterial({ color: 0xa9a49c, side: THREE.DoubleSide }))
  mesh(buf.glass, new THREE.MeshPhongMaterial({ color: hex(fa?.glass, mainUse === 'office' ? 0x6f97b8 : 0x86a9c2), specular: 0xbfd4e6, shininess: 70, side: THREE.DoubleSide }))
  mesh(buf.rail, new THREE.MeshBasicMaterial({ color: 0xcfe3ef, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }))
  const lines = (arr: number[], color: number, opacity: number) => {
    if (!arr.length) return
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color, transparent: true, opacity })))
  }
  lines(buf.mull, hex(fa?.frame, 0x6b655d).getHex(), 0.55)
  lines(buf.lines, 0x4a433b, 0.6)
  return g
}

export function envelopeGroup(env: Envelope, colour: number): THREE.Group {
  const g = new THREE.Group()
  const geom = envelopeGeometry(env)
  const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  g.add(new THREE.Mesh(geom, mat))
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 20), new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.9 }))
  g.add(edges)
  return g
}

/** Thin translucent wall around the plot so it reads in 3D. */
export function plotFence(plot: Ring): THREE.Group {
  const g = new THREE.Group()
  const pos: number[] = []
  pushWalls(pos, [[plot]], 0, () => 1.2)
  const mat = new THREE.MeshBasicMaterial({ color: 0xe8590c, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
  g.add(new THREE.Mesh(geometryFrom(pos), mat))
  return g
}

export class MassingLayer implements maplibregl.CustomLayerInterface {
  id = 'massing'
  type = 'custom' as const
  renderingMode = '3d' as const
  private map?: maplibregl.Map
  private renderer?: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.Camera()
  private model = new THREE.Matrix4()
  private content = new THREE.Group()
  private sun: THREE.DirectionalLight

  constructor() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.55))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(-0.45, -0.6, 0.9) // from SW-ish, high (Bangkok sun)
    this.scene.add(sun)
    this.sun = sun
    const fill = new THREE.DirectionalLight(0xffffff, 0.55)
    fill.position.set(0.6, 0.5, 0.4)
    this.scene.add(fill)
    this.scene.add(this.content)
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true })
    this.renderer.autoClear = false
  }

  setFrame(frame: LocalFrame) {
    this.model = new THREE.Matrix4().makeTranslation(frame.ox, frame.oy, 0).scale(new THREE.Vector3(frame.s, -frame.s, 1))
  }

  /** Light the massing from the actual sun when the shadow study is on. */
  setSun(s: { altitude: number; azimuth: number } | null) {
    if (s && s.altitude > 0) {
      const c = Math.cos(s.altitude)
      this.sun.position.set(Math.sin(s.azimuth) * c, Math.cos(s.azimuth) * c, Math.sin(s.altitude))
    } else this.sun.position.set(-0.45, -0.6, 0.9)
    this.map?.triggerRepaint()
  }

  setContent(groups: THREE.Object3D[]) {
    for (const child of [...this.content.children]) {
      this.content.remove(child)
      child.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose?.()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose?.()
      })
    }
    for (const g of groups) {
      // our camera matrix is a composite, so three's frustum test is unreliable
      g.traverse((o) => (o.frustumCulled = false))
      this.content.add(g)
    }
    this.map?.triggerRepaint()
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: maplibregl.CustomRenderMethodInput) {
    if (!this.renderer) return
    // MapLibre 6 hands custom layers a matrix that takes x, y in world pixels
    // (0..worldSize) and z in metres, so scale x, y (mercator) up and leave z alone. Done in float64
    // here so the large offsets cancel before three.js uploads it as float32.
    const ws = (this.map as unknown as { transform?: { worldSize?: number } })?.transform?.worldSize ?? 512 * Math.pow(2, this.map?.getZoom() ?? 0)
    const m = new THREE.Matrix4().fromArray(args.modelViewProjectionMatrix as unknown as number[])
    m.multiply(new THREE.Matrix4().makeScale(ws, ws, 1)).multiply(this.model)
    this.camera.projectionMatrix = m
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()
    this.renderer.resetState()
    this.renderer.render(this.scene, this.camera)
  }
}
