// three.js geometry for the legal envelope and concept massing, rendered as a
// MapLibre custom layer so it shares the depth buffer with the real 3D city.
import * as THREE from 'three'
import earcut from 'earcut'
import type * as maplibregl from 'maplibre-gl'
import type { MultiPoly, Pt, Ring } from '../geo/geom'
import { difference } from '../geo/geom'
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

export function conceptGroup(c: Concept): THREE.Group {
  const g = new THREE.Group()
  const byUse = new Map<Floor['use'], number[]>()
  for (const b of c.blocks)
    for (const f of b.floors) {
      const arr = byUse.get(f.use) ?? []
      const gap = Math.min(0.35, (f.z1 - f.z0) * 0.12)
      pushTriangles(arr, f.plate, () => f.z1 - gap)
      pushTriangles(arr, f.plate, () => f.z0)
      pushWalls(arr, f.plate, f.z0, () => f.z1 - gap)
      byUse.set(f.use, arr)
    }
  for (const [use, arr] of byUse) {
    const geom = geometryFrom(arr)
    const mat = new THREE.MeshLambertMaterial({ color: USE_COLOUR[use], side: THREE.DoubleSide })
    g.add(new THREE.Mesh(geom, mat))
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 25), new THREE.LineBasicMaterial({ color: 0x5b5146, transparent: true, opacity: 0.55 }))
    g.add(edges)
  }
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
