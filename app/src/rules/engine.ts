// Rules engine: from a plot + road + zone + building type to
// (1) the applicable rules, (2) two legal envelopes, (3) concept designs,
// (4) an independent pass/fail check of each concept.
//
// Everything is in a local metric frame (metres). See docs/DECISIONS.md.

import {
  type MultiPoly,
  type Pt,
  type Ring,
  clipHalfPlane,
  distToSegment,
  dist,
  insetByEdges,
  insetMP,
  intersection,
  mpArea,
  polyArea,
  rot,
  signedArea,
  signedDistToLine,
  union,
  isSelfIntersecting,
} from '../geo/geom'
import { ZONES, type Zone, type ZoneCode } from './zones'

export type BuildingType = 'condo' | 'hotel' | 'office'

export interface Road {
  width: number
  name?: string
}

export interface Inputs {
  plot: Ring // CCW, metres
  roads: (Road | null)[] // one entry per edge i (plot[i] -> plot[i+1])
  zone: ZoneCode
  type: BuildingType
  nearStation: boolean
  bonusPct: number // FAR bonus claimed, 0..20 (cl. 51-57)
}

export interface TypeSpec {
  label: string
  residential: boolean
  groundH: number
  typH: number
  lowTypH: number
  lowGroundH: number
  efficiency: number // net sellable or lettable / gross
  unitArea: number // condo unit or hotel key, net m²
  towerDepth: number
  towerMaxLen: number
  parking: (gfaNonParking: number, units: number) => number
  parkingRule: string
}

// Parking: Ministerial Regulation No. 7 (B.E. 2517) as amended by No. 41 (B.E. 2537), Bangkok figures.
export const TYPES: Record<BuildingType, TypeSpec> = {
  condo: {
    label: 'Condominium',
    residential: true,
    groundH: 4.5,
    typH: 3.0,
    lowGroundH: 3.2,
    lowTypH: 2.8,
    efficiency: 0.72,
    unitArea: 35,
    towerDepth: 21,
    towerMaxLen: 60,
    parking: (g) => Math.ceil(g / 120),
    parkingRule: '1 space per 120 m² of floor area (Bangkok, MR 7 / MR 41)',
  },
  hotel: {
    label: 'Hotel',
    residential: false,
    groundH: 5.0,
    typH: 3.2,
    lowGroundH: 4.0,
    lowTypH: 3.0,
    efficiency: 0.62,
    unitArea: 32,
    towerDepth: 19,
    towerMaxLen: 60,
    parking: (_g, units) => Math.ceil(units / 5),
    parkingRule: '1 space per 5 rooms (Bangkok, MR 7 / MR 41)',
  },
  office: {
    label: 'Office',
    residential: false,
    groundH: 5.0,
    typH: 3.8,
    lowGroundH: 4.5,
    lowTypH: 3.6,
    efficiency: 0.75,
    unitArea: 0,
    towerDepth: 26,
    towerMaxLen: 50,
    parking: (g) => Math.ceil(g / 60),
    parkingRule: '1 space per 60 m² of floor area (Bangkok, MR 7 / MR 41)',
  },
}

export const PARKING_GROSS_M2 = 30 // per space incl. aisles and ramps (structured parking)
export const HIGH_RISE_M = 23
export const EXTRA_LARGE_M2 = 10000

// ---------- Rule primitives ----------

/** BKK Building Control Ordinance 2544 cl.50 / MR55 cl.41: setback from the road boundary. */
export function roadSetback(width: number): number {
  if (width < 10) return Math.max(0, 6 - width / 2) // 6 m from centreline
  if (width <= 20) return width / 10
  return 2
}

export interface SkyPlane {
  a: Pt
  b: Pt
  width: number
  edge: number
}

/** MR55 cl.44-46 / BKK cl.49: max height at p = 2 x distance to the far side of the (wider) road. */
export function planeHeight(pl: SkyPlane, p: Pt): number {
  return 2 * (pl.width + signedDistToLine(p, pl.a, pl.b))
}

export function chooseSkyPlane(plot: Ring, roads: (Road | null)[]): SkyPlane | null {
  let best: SkyPlane | null = null
  let bestLen = 0
  roads.forEach((r, i) => {
    if (!r) return
    const a = plot[i]
    const b = plot[(i + 1) % plot.length]
    const len = dist(a, b)
    if (!best || r.width > best.width || (r.width === best.width && len > bestLen)) {
      best = { a, b, width: r.width, edge: i }
      bestLen = len
    }
  })
  return best
}

/** Region of a footprint where the sky plane allows at least height z. */
export function clipToPlane(mp: MultiPoly, pl: SkyPlane, z: number): MultiPoly {
  return clipHalfPlane(mp, pl.a, pl.b, z / 2 - pl.width)
}

// ---------- Envelopes ----------

export type BuildingClass = 'low' | 'high'

export interface Band {
  z0: number
  z1: number
  region: MultiPoly // footprint before the sky plane
  sideSetback: number
}

export interface Envelope {
  cls: BuildingClass
  bands: Band[]
  plane: SkyPlane
  maxHeight: number
  groundArea: number
  setbacks: number[][] // per band, per edge
}

function edgeSetbacks(inp: Inputs, side: number, roadMin: number): number[] {
  return inp.roads.map((r) => (r ? Math.max(roadSetback(r.width), roadMin) : side))
}

export function buildEnvelope(inp: Inputs, cls: BuildingClass, plane: SkyPlane): Envelope {
  const bands: Band[] = []
  const setbacks: number[][] = []
  if (cls === 'low') {
    // BKK cl.54: openings 2 m up to 9 m / floor 2, 3 m above. BKK cl.55: >15 m tall => 2 m clear all round.
    const s1 = edgeSetbacks(inp, 2, 2)
    const s2 = edgeSetbacks(inp, 3, 2)
    bands.push({ z0: 0, z1: 9, region: insetByEdges(inp.plot, s1), sideSetback: 2 })
    bands.push({ z0: 9, z1: HIGH_RISE_M, region: insetByEdges(inp.plot, s2), sideSetback: 3 })
    setbacks.push(s1, s2)
  } else {
    // MR33 cl.4: >=6 m from neighbours and from the public road.
    const s = edgeSetbacks(inp, 6, 6)
    const region = insetByEdges(inp.plot, s)
    let zMax = 0
    for (const p of region) for (const r of p) for (const v of r) zMax = Math.max(zMax, planeHeight(plane, v))
    bands.push({ z0: 0, z1: Math.min(zMax, 400), region, sideSetback: 6 })
    setbacks.push(s)
  }
  let maxHeight = 0
  for (const b of bands) {
    for (const p of b.region)
      for (const r of p) for (const v of r) maxHeight = Math.max(maxHeight, Math.min(b.z1, planeHeight(plane, v)))
  }
  return {
    cls,
    bands,
    plane,
    maxHeight,
    groundArea: mpArea(clipToPlane(bands[0].region, plane, 0)),
    setbacks,
  }
}

// ---------- Concepts ----------

export interface Floor {
  z0: number
  z1: number
  plate: MultiPoly
  area: number
  use: 'lobby' | 'parking' | 'residential' | 'hotel' | 'office' | 'amenity'
}

export interface Block {
  name: string
  floors: Floor[]
}

export interface Concept {
  id: string
  name: string
  tagline: string
  cls: BuildingClass
  blocks: Block[]
  gfa: number
  height: number
  floors: number
  footprint: number // projected roofed area
  openSpace: number
  units: number
  parkingRequired: number
  parkingProvided: number
  checks: Check[]
  infeasible?: string
}

export interface Check {
  id: string
  label: string
  required: string
  actual: string
  pass: boolean | null // null = information / triggered obligation
  source: string
}

function useFor(t: BuildingType): Floor['use'] {
  return t === 'condo' ? 'residential' : t
}

export interface Limits {
  plotArea: number
  farCap: number
  gfaCap: number // FAR (+bonus) and zoning use caps combined
  gfaCapReason: string
  zone: Zone
  plane: SkyPlane | null
  useBlocked: string | null
}

export function limits(inp: Inputs): Limits {
  const zone = ZONES[inp.zone]
  const plotArea = Math.abs(signedArea(inp.plot))
  const bonus = Math.max(0, Math.min(20, inp.bonusPct))
  const farCap = zone.far * (1 + bonus / 100)
  let gfaCap = farCap * plotArea
  let gfaCapReason = `FAR ${fmt(farCap, 2)} × plot`
  let useBlocked: string | null = null
  const plane = chooseSkyPlane(inp.plot, inp.roads)
  const maxRoad = Math.max(0, ...inp.roads.map((r) => r?.width ?? 0))
  if (inp.type === 'office') {
    // cl.15(12): find largest band allowed by road / station
    let allowed = 0
    for (const band of zone.office) {
      if (band.minRoad === null) break
      if (inp.nearStation || maxRoad >= band.minRoad) allowed = band.upTo
    }
    if (allowed < gfaCap) {
      gfaCap = allowed
      gfaCapReason = `ย.8 cl.15(12): offices limited to ${fmt(allowed)} m² on a ${fmt(maxRoad, 1)} m road${inp.nearStation ? ' near a station' : ''}`
    }
  }
  if (inp.type === 'hotel' && !inp.nearStation && maxRoad < zone.hotel.minRoad) {
    // ≤50 rooms
    const maxGfa = (zone.hotel.freeRooms * TYPES.hotel.unitArea) / TYPES.hotel.efficiency
    if (maxGfa < gfaCap) {
      gfaCap = maxGfa
      gfaCapReason = `ย.8 cl.15(8): hotels limited to ${zone.hotel.freeRooms} rooms unless on a ≥${zone.hotel.minRoad} m road or within 500 m of a station`
    }
  }
  if (!plane) useBlocked = 'Mark at least one plot edge as facing a public road.'
  return { plotArea, farCap, gfaCap, gfaCapReason, zone, plane, useBlocked }
}

function openSpaceRequired(inp: Inputs, L: Limits, gfa: number, maxPlate: number, xl: boolean): { req: number; why: string } {
  const spec = TYPES[inp.type]
  const cands: [number, string][] = [
    [(L.zone.osrPct / 100) * gfa, `OSR ${L.zone.osrPct}% of floor area`],
    [(spec.residential ? 0.3 : 0.1) * maxPlate, `${spec.residential ? 30 : 10}% of largest floor (MR55 cl.33)`],
  ]
  if (xl) cands.push([(spec.residential ? 0.3 : 0.1) * L.plotArea, `${spec.residential ? 30 : 10}% of plot (MR33 cl.6)`])
  cands.sort((a, b) => b[0] - a[0])
  return { req: cands[0][0], why: cands[0][1] }
}

function bisect(lo: number, hi: number, ok: (t: number) => boolean, iters = 28): number | null {
  // smallest t in [lo,hi] with ok(t) (ok assumed monotone false->true)
  if (ok(lo)) return lo
  if (!ok(hi)) return null
  for (let i = 0; i < iters; i++) {
    const m = (lo + hi) / 2
    if (ok(m)) hi = m
    else lo = m
  }
  return hi
}

/** Concept A: low-rise below the 23 m high-rise line, footprint follows the plot. */
export function lowRiseConcept(inp: Inputs, L: Limits): Concept {
  const spec = TYPES[inp.type]
  const plane = L.plane!
  const n = Math.max(1, Math.floor((HIGH_RISE_M - 0.05 - spec.lowGroundH) / spec.lowTypH) + 1)
  const s = edgeSetbacks(inp, 3, 2) // 3 m sides on every floor (conservative, see DECISIONS)
  const base = insetByEdges(inp.plot, s)
  const tops = Array.from({ length: n }, (_, k) => spec.lowGroundH + k * spec.lowTypH)

  const build = (t: number, floors = n) => {
    const fp = insetMP(base, t)
    const plates: MultiPoly[] = []
    for (let k = 0; k < floors; k++) plates.push(clipToPlane(fp, plane, tops[k]))
    return plates
  }
  const evalPlates = (plates: MultiPoly[]) => {
    const areas = plates.map(mpArea)
    const gfa = areas.reduce((a, b) => a + b, 0)
    const cover = mpArea(union(...plates))
    const maxPlate = Math.max(0, ...areas)
    return { areas, gfa, cover, maxPlate }
  }
  const capGfa = Math.min(L.gfaCap, EXTRA_LARGE_M2 - 1)
  const feasible = (t: number, floors: number) => {
    const e = evalPlates(build(t, floors))
    if (e.gfa <= 0) return true
    const os = openSpaceRequired(inp, L, e.gfa, e.maxPlate, false)
    return e.gfa <= capGfa && L.plotArea - e.cover >= os.req
  }
  // Try full height first; fewer floors only if no inset works.
  let floors = n
  let t: number | null = null
  const maxInset = 60
  while (floors >= 1) {
    t = bisect(0, maxInset, (x) => feasible(x, floors))
    if (t !== null && evalPlates(build(t, floors)).gfa > 50) break
    floors--
  }
  const plates = t === null ? [] : build(t, floors)
  const floorsArr: Floor[] = plates.map((plate, k) => ({
    z0: k === 0 ? 0 : tops[k - 1],
    z1: tops[k],
    plate,
    area: mpArea(plate),
    use: k === 0 && inp.type !== 'condo' ? 'lobby' : useFor(inp.type),
  }))
  // Parking: ground floor is lobby + parking; convert floors above to parking until demand is met.
  if (floorsArr.length) {
    floorsArr[0].use = 'lobby'
    for (let k = 1; k < floorsArr.length - 1; k++) {
      const trial = assemble(inp, L, { id: 'x', name: '', tagline: '', cls: 'low', blocks: [{ name: '', floors: floorsArr }], surfaceParking: true, skipChecks: true })
      if (trial.parkingProvided >= trial.parkingRequired) break
      floorsArr[k].use = 'parking'
      floorsArr[k].z1 = floorsArr[k].z1 // same storey height
    }
  }
  const c = assemble(inp, L, {
    id: 'low',
    name: `${floorsArr.length}-storey low-rise`,
    tagline: 'Stays under 23 m and 10,000 m², so MR33 high-rise rules do not apply. Footprint follows the plot.',
    cls: 'low',
    blocks: [{ name: 'Low-rise block', floors: floorsArr }],
    surfaceParking: true,
  })
  if (!floorsArr.length) c.infeasible = 'No floor plate fits inside the low-rise setbacks.'
  return c
}

/** Concept B: tower on a parking podium, tower slab placed far from the road to climb the sky plane. */
export function towerConcept(inp: Inputs, L: Limits): Concept {
  const spec = TYPES[inp.type]
  const plane = L.plane!
  const s = edgeSetbacks(inp, 6, 6)
  const base6 = insetByEdges(inp.plot, s)
  const theta = Math.atan2(plane.b[1] - plane.a[1], plane.b[0] - plane.a[0])
  // rotated frame: x along road, y = distance from road line (inward)
  const toR = (p: Pt): Pt => {
    const q = rot([p[0] - plane.a[0], p[1] - plane.a[1]], -theta)
    return q
  }
  const fromR = (q: Pt): Pt => {
    const p = rot(q, theta)
    return [p[0] + plane.a[0], p[1] + plane.a[1]]
  }
  const baseR: MultiPoly = base6.map((poly) => poly.map((r) => r.map(toR)))
  let ymin = Infinity
  let ymax = -Infinity
  for (const p of baseR) for (const r of p) for (const [, y] of r) {
    ymin = Math.min(ymin, y)
    ymax = Math.max(ymax, y)
  }

  const xIntervals = (y: number): [number, number][] => {
    const xs: number[] = []
    for (const p of baseR)
      for (const r of p)
        for (let i = 0; i < r.length; i++) {
          const [x1, y1] = r[i]
          const [x2, y2] = r[(i + 1) % r.length]
          if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
        }
    xs.sort((a, b) => a - b)
    const out: [number, number][] = []
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]])
    return out
  }
  const intersectIv = (a: [number, number][], b: [number, number][]) => {
    const out: [number, number][] = []
    for (const [a0, a1] of a)
      for (const [b0, b1] of b) {
        const lo = Math.max(a0, b0)
        const hi = Math.min(a1, b1)
        if (hi - lo > 0.01) out.push([lo, hi])
      }
    return out
  }

  type Cand = { y0: number; x0: number; x1: number; depth: number }
  const cands: Cand[] = []
  const D = spec.towerDepth
  for (let depth = D; depth >= Math.max(12, D * 0.6); depth -= 2) {
    if (ymax - ymin < depth) continue
    for (let y0 = ymax - depth; y0 >= ymin - 1e-6; y0 -= 1) {
      let iv: [number, number][] | null = null
      for (let k = 0; k <= 6; k++) {
        const yy = y0 + (depth * k) / 6 + (k === 0 ? 0.01 : k === 6 ? -0.01 : 0)
        const cur = xIntervals(yy)
        iv = iv === null ? cur : intersectIv(iv, cur)
        if (!iv.length) break
      }
      if (!iv || !iv.length) continue
      for (const [x0, x1] of iv) {
        if (x1 - x0 < 12) continue
        const len = Math.min(spec.towerMaxLen, x1 - x0)
        const cx = (x0 + x1) / 2
        cands.push({ y0, x0: cx - len / 2, x1: cx + len / 2, depth })
      }
    }
    if (cands.length) break
  }

  const rectPlate = (c: Cand, z: number): MultiPoly => {
    const yLow = Math.max(c.y0, z / 2 - plane.width)
    if (c.y0 + c.depth - yLow < c.depth * 0.6) return []
    const ring: Ring = [
      [c.x0, yLow],
      [c.x1, yLow],
      [c.x1, c.y0 + c.depth],
      [c.x0, c.y0 + c.depth],
    ].map((q) => fromR(q as Pt))
    return [[ring]]
  }

  // Iterate podium size <-> parking demand
  let podiumFloors = 2
  let best: { c: Cand; tower: Floor[]; podium: Floor[] } | null = null
  for (let iter = 0; iter < 5; iter++) {
    const podTop = (k: number) => spec.groundH + (k - 1) * 3.0
    const zPod = podTop(podiumFloors)
    // Podium footprint: base6 inset to respect open space (estimated with full GFA)
    const podiumPlates = (t: number) => {
      const fp = insetMP(base6, t)
      const out: MultiPoly[] = []
      for (let k = 1; k <= podiumFloors; k++) out.push(clipToPlane(fp, plane, podTop(k)))
      return out
    }
    best = null
    let bestGfa = -1
    for (const c of cands) {
      // tower floors given podium; cap computed later
      const tower: Floor[] = []
      let z = zPod
      for (let i = 0; i < 200; i++) {
        const z1 = z + spec.typH
        const plate = rectPlate(c, z1)
        if (!plate.length) break
        tower.push({ z0: z, z1, plate, area: mpArea(plate), use: useFor(inp.type) })
        z = z1
      }
      const g = tower.reduce((a, f) => a + f.area, 0)
      const score = Math.min(g, L.gfaCap) + c.y0 * 0.01
      if (score > bestGfa) {
        bestGfa = score
        best = { c, tower, podium: [] }
      }
    }
    if (!best) break
    // Choose podium inset so open space holds with this tower
    const towerFp = rectPlate(best.c, zPod + spec.typH)
    const towerFull = best.tower
    const t = bisect(0, 60, (tt) => {
      const pp = podiumPlates(tt)
      const podGfa = pp.reduce((a, m) => a + mpArea(m), 0)
      const towerG = Math.min(
        towerFull.reduce((a, f) => a + f.area, 0),
        Math.max(0, L.gfaCap - podGfa),
      )
      const gfa = podGfa + towerG
      const cover = mpArea(union(...pp, towerFp))
      const maxPlate = Math.max(0, ...pp.map(mpArea), ...towerFull.map((f) => f.area))
      const os = openSpaceRequired(inp, L, gfa, maxPlate, true)
      return L.plotArea - cover >= os.req && podGfa <= L.gfaCap
    })
    const pp = t === null ? [] : podiumPlates(t)
    const podium: Floor[] = pp.map((plate, k) => ({
      z0: k === 0 ? 0 : podTop(k),
      z1: podTop(k + 1),
      plate,
      area: mpArea(plate),
      use: k === 0 ? 'lobby' : 'parking',
    }))
    const podGfa = podium.reduce((a, f) => a + f.area, 0)
    // trim tower to GFA cap (whole floors)
    const tower: Floor[] = []
    let acc = podGfa
    for (const f of towerFull) {
      if (acc + f.area > L.gfaCap + 1e-6) break
      tower.push(f)
      acc += f.area
    }
    best = { c: best.c, tower, podium }
    // parking demand -> podium floors
    const nonPark = acc - podium.filter((f) => f.use === 'parking').reduce((a, f) => a + f.area, 0)
    const units = spec.unitArea ? Math.floor((tower.reduce((a, f) => a + f.area, 0) * spec.efficiency) / spec.unitArea) : 0
    const need = spec.parking(nonPark, units)
    const groundSpaces = podium[0] ? Math.floor((podium[0].area * 0.4) / PARKING_GROSS_M2) : 0
    const perFloor = podium[1] ? podium[1].area / PARKING_GROSS_M2 : podium[0] ? podium[0].area / PARKING_GROSS_M2 : 1
    const wanted = 1 + Math.max(0, Math.ceil((need - groundSpaces) / Math.max(1, perFloor)))
    const next = Math.min(12, Math.max(1, wanted))
    if (next === podiumFloors) break
    podiumFloors = next
  }

  const blocks: Block[] = []
  if (best) {
    if (best.podium.length) blocks.push({ name: 'Podium', floors: best.podium })
    if (best.tower.length) blocks.push({ name: 'Tower', floors: best.tower })
  }
  const c = assemble(inp, L, {
    id: 'tower',
    name: best ? `${best.podium.length + best.tower.length}-storey tower on podium` : 'Tower on podium',
    tagline: 'High-rise (MR33): 6 m clear all round, slab set back from the road so it can climb the 2:1 height plane.',
    cls: 'high',
    blocks,
    surfaceParking: false,
  })
  if (!best || !best.tower.length) c.infeasible = 'No tower slab (≥12 m deep) fits inside the 6 m high-rise setbacks.'
  return c
}

interface AssembleArgs {
  id: string
  name: string
  tagline: string
  cls: BuildingClass
  blocks: Block[]
  surfaceParking: boolean
  skipChecks?: boolean
}

function assemble(inp: Inputs, L: Limits, a: AssembleArgs): Concept {
  const spec = TYPES[inp.type]
  const floors = a.blocks.flatMap((b) => b.floors)
  const gfa = floors.reduce((s, f) => s + f.area, 0)
  const height = Math.max(0, ...floors.map((f) => f.z1))
  const allPlates = floors.map((f) => f.plate)
  const footprint = allPlates.length ? mpArea(union(...allPlates)) : 0
  const openSpace = L.plotArea - footprint
  const programme = floors.filter((f) => f.use !== 'parking' && f.use !== 'lobby').reduce((s, f) => s + f.area, 0)
  const units = spec.unitArea ? Math.floor((programme * spec.efficiency) / spec.unitArea) : 0
  const parkingArea = floors.filter((f) => f.use === 'parking').reduce((s, f) => s + f.area, 0)
  const nonPark = gfa - parkingArea
  const parkingRequired = spec.parking(nonPark, units)
  // structured parking + share of ground floor + surface spaces in open space beyond the planted half
  const lobby = floors.filter((f) => f.use === 'lobby').reduce((s, f) => s + f.area, 0)
  let parkingProvided = Math.floor(parkingArea / PARKING_GROSS_M2) + Math.floor((lobby * 0.4) / PARKING_GROSS_M2)
  if (a.surfaceParking) {
    const paved = Math.max(0, openSpace * (1 - L.zone.plantedShareOfOpen))
    parkingProvided += Math.floor((paved * 0.6) / 25) + (inp.type === 'condo' ? 0 : 0)
  }
  const c: Concept = {
    id: a.id,
    name: a.name,
    tagline: a.tagline,
    cls: a.cls,
    blocks: a.blocks,
    gfa,
    height,
    floors: Math.max(0, ...a.blocks.map((b) => b.floors.length)) + (a.blocks.length > 1 ? a.blocks[0].floors.length : 0),
    footprint,
    openSpace,
    units,
    parkingRequired,
    parkingProvided,
    checks: [],
  }
  c.floors = new Set(floors.map((f) => f.z1.toFixed(2))).size
  if (!a.skipChecks) c.checks = verify(inp, L, c)
  return c
}

// ---------- Independent verification ----------

export function verify(inp: Inputs, L: Limits, c: Concept): Check[] {
  const spec = TYPES[inp.type]
  const zone = L.zone
  const plane = L.plane!
  const floors = c.blocks.flatMap((b) => b.floors)
  const checks: Check[] = []
  if (!floors.length) return checks
  const isHigh = c.height >= HIGH_RISE_M
  const isXL = c.gfa >= EXTRA_LARGE_M2
  const mr33 = isHigh || isXL
  const far = c.gfa / L.plotArea

  checks.push({
    id: 'far',
    label: 'Floor area ratio',
    required: `≤ ${fmt(L.farCap, 2)}${inp.bonusPct ? ` (base ${zone.far} + ${inp.bonusPct}% bonus)` : ''}`,
    actual: `${fmt(far, 2)} (${fmt(c.gfa)} m²)`,
    pass: c.gfa <= L.farCap * L.plotArea + 0.5,
    source: `2013 plan cl.${zone.clause}(1)${inp.bonusPct ? ', cl.51-57' : ''}`,
  })
  const osr = (c.openSpace / c.gfa) * 100
  checks.push({
    id: 'osr',
    label: 'Open space ratio',
    required: `≥ ${zone.osrPct}% of floor area (${fmt((zone.osrPct / 100) * c.gfa)} m²)`,
    actual: `${fmt(osr, 1)}% (${fmt(c.openSpace)} m² open)`,
    pass: c.openSpace + 0.5 >= (zone.osrPct / 100) * c.gfa,
    source: `2013 plan cl.${zone.clause}(2)`,
  })
  checks.push({
    id: 'planted',
    label: 'Planted permeable ground',
    required: `≥ 50% of open space (${fmt(c.openSpace * 0.5)} m²)`,
    actual: `${fmt(c.openSpace * 0.5)} m² allocated in this concept`,
    pass: c.openSpace > 0,
    source: `2013 plan cl.${zone.clause}(2)`,
  })
  const maxPlate = Math.max(...floors.map((f) => f.area))
  const r33 = spec.residential ? 0.3 : 0.1
  checks.push({
    id: 'mr55-open',
    label: 'Open space vs largest floor',
    required: `≥ ${r33 * 100}% of largest floor (${fmt(r33 * maxPlate)} m²)`,
    actual: `${fmt(c.openSpace)} m²`,
    pass: c.openSpace + 0.5 >= r33 * maxPlate,
    source: 'MR55 cl.33',
  })
  if (mr33) {
    checks.push({
      id: 'mr33-open',
      label: 'High-rise open space vs plot',
      required: `≥ ${r33 * 100}% of plot (${fmt(r33 * L.plotArea)} m²)`,
      actual: `${fmt((c.openSpace / L.plotArea) * 100, 1)}% of plot`,
      pass: c.openSpace + 0.5 >= r33 * L.plotArea,
      source: 'MR33 cl.6',
    })
  }

  // Setbacks measured from the final geometry, edge by edge
  let worst = { margin: Infinity, req: 0, act: 0, edge: -1, z: 0 }
  for (const f of floors) {
    const zTop = f.z1
    for (let i = 0; i < inp.plot.length; i++) {
      const road = inp.roads[i]
      let req: number
      if (mr33) req = road ? Math.max(6, roadSetback(road.width)) : 6
      else {
        const side = zTop > 9 ? 3 : 2
        req = road ? Math.max(roadSetback(road.width), c.height > 15 ? 2 : 1) : side
      }
      const a = inp.plot[i]
      const b = inp.plot[(i + 1) % inp.plot.length]
      let act = Infinity
      for (const p of f.plate) for (const r of p) for (const v of r) act = Math.min(act, distToSegment(v, a, b))
      // also edge-vs-plate (plot vertex near plate edge)
      for (const p of f.plate)
        for (const r of p)
          for (let k = 0; k < r.length; k++) {
            act = Math.min(act, distToSegment(a, r[k], r[(k + 1) % r.length]), distToSegment(b, r[k], r[(k + 1) % r.length]))
          }
      if (act - req < worst.margin) worst = { margin: act - req, req, act, edge: i, z: zTop }
    }
  }
  checks.push({
    id: 'setbacks',
    label: 'Setbacks from boundaries and road',
    required: mr33 ? '6 m all round, road setback if larger' : 'Road: cl.50 setback; sides 2 m (≤9 m) / 3 m (>9 m)',
    actual: worst.edge < 0 ? '-' : `Tightest: ${fmt(worst.act, 2)} m vs ${fmt(worst.req, 2)} m (edge ${worst.edge + 1})`,
    pass: worst.margin >= -0.05,
    source: mr33 ? 'MR33 cl.4; BKK Ord. 2544 cl.50' : 'BKK Ord. 2544 cl.50, 54, 55',
  })

  // Height plane, measured on every plate vertex
  let worstH = { over: -Infinity, z: 0, allow: 0 }
  for (const f of floors)
    for (const p of f.plate)
      for (const r of p)
        for (const v of r) {
          const allow = planeHeight(plane, v)
          if (f.z1 - allow > worstH.over) worstH = { over: f.z1 - allow, z: f.z1, allow }
        }
  checks.push({
    id: 'height-plane',
    label: 'Height vs road width (2:1 plane)',
    required: `Height ≤ 2 × distance to far side of ${fmt(plane.width, 1)} m road`,
    actual: worstH.over > 0 ? `Exceeds by ${fmt(worstH.over, 2)} m` : `Max ${fmt(c.height, 1)} m, ${fmt(-worstH.over, 1)} m spare at tightest point`,
    pass: worstH.over <= 0.01,
    source: 'BKK Ord. 2544 cl.49; MR55 cl.44-46',
  })

  checks.push({
    id: 'class',
    label: 'Building class',
    required: c.cls === 'low' ? '< 23 m and < 10,000 m² (stay out of MR33)' : 'High-rise / extra-large rules apply',
    actual: `${fmt(c.height, 1)} m, ${fmt(c.gfa)} m² → ${mr33 ? (isHigh ? 'high-rise' : 'extra-large') : 'ordinary'}`,
    pass: c.cls === 'low' ? !mr33 : true,
    source: 'MR33 cl.1',
  })

  if (mr33) {
    const need = c.gfa > 30000 ? 18 : 10
    let frontage = 0
    inp.roads.forEach((r, i) => {
      if (r && r.width >= need) frontage = Math.max(frontage, dist(inp.plot[i], inp.plot[(i + 1) % inp.plot.length]))
    })
    checks.push({
      id: 'frontage',
      label: 'High-rise road access',
      required: `A side ≥ 12 m on a road ≥ ${need} m wide`,
      actual: frontage > 0 ? `${fmt(frontage, 1)} m on a qualifying road` : `No edge on a ≥${need} m road`,
      pass: frontage >= 12,
      source: 'MR33 cl.2',
    })
  }

  // BKK cl.52(6)/53: >3 floors needs 12 m front fire space unless face on road within 20 m and >= 1/8 perimeter
  if (c.floors > 3) {
    const roadEdges = inp.roads.map((r, i) => (r ? i : -1)).filter((i) => i >= 0)
    const ground = floors.filter((f) => f.z0 === 0).map((f) => f.plate)
    const g = union(...ground)
    let facing = 0
    let perim = 0
    for (const p of g)
      for (const r of p)
        for (let k = 0; k < r.length; k++) {
          const a = r[k]
          const b = r[(k + 1) % r.length]
          const len = dist(a, b)
          perim += len
          const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          for (const i of roadEdges) {
            const ea = inp.plot[i]
            const eb = inp.plot[(i + 1) % inp.plot.length]
            if (distToSegment(mid, ea, eb) <= 20 && distToSegment(a, ea, eb) <= 20 && distToSegment(b, ea, eb) <= 20) {
              facing += len
              break
            }
          }
        }
    checks.push({
      id: 'fire-front',
      label: 'Fire-truck frontage',
      required: `Face within 20 m of road ≥ 1/8 of perimeter (${fmt(perim / 8, 1)} m)`,
      actual: `${fmt(facing, 1)} m within 20 m of the road`,
      pass: facing >= perim / 8,
      source: 'BKK Ord. 2544 cl.52(6), 53',
    })
  }

  // Zoning use permission
  const maxRoad = Math.max(0, ...inp.roads.map((r) => r?.width ?? 0))
  if (inp.type === 'condo') {
    checks.push({ id: 'use', label: 'Use permitted in zone', required: 'Condominium in ย.8', actual: 'No size or road limit', pass: true, source: `2013 plan cl.${zone.clause}` })
  } else if (inp.type === 'hotel') {
    const ok = c.units <= zone.hotel.freeRooms || maxRoad >= zone.hotel.minRoad || inp.nearStation
    checks.push({
      id: 'use',
      label: 'Use permitted in zone',
      required: `>${zone.hotel.freeRooms} rooms needs ≥${zone.hotel.minRoad} m road or a station within 500 m`,
      actual: `${c.units} rooms, ${fmt(maxRoad, 1)} m road${inp.nearStation ? ', near station' : ''}`,
      pass: ok,
      source: `2013 plan cl.${zone.clause}(8)`,
    })
  } else {
    const office = c.gfa - floors.filter((f) => f.use === 'parking').reduce((s, f) => s + f.area, 0)
    checks.push({
      id: 'use',
      label: 'Use permitted in zone',
      required: 'Office floor area within the road-width band',
      actual: `${fmt(office)} m² office (cap ${fmt(L.gfaCap)} m²)`,
      pass: c.gfa <= L.gfaCap + 0.5,
      source: `2013 plan cl.${zone.clause}(12)`,
    })
  }

  checks.push({
    id: 'parking',
    label: 'Parking',
    required: `${c.parkingRequired} spaces: ${spec.parkingRule}`,
    actual: `${c.parkingProvided} spaces provided`,
    pass: c.parkingProvided >= c.parkingRequired,
    source: 'MR 7 (2517) / MR 41 (2537)',
  })

  const eia = inp.type === 'office' ? c.gfa >= 10000 : c.units >= 80 || c.gfa >= 4000
  checks.push({
    id: 'eia',
    label: 'Environmental impact assessment',
    required: inp.type === 'office' ? 'Triggered at ≥ 10,000 m²' : 'Triggered at ≥ 80 units/rooms or ≥ 4,000 m²',
    actual: eia ? 'EIA required (adds ~6-12 months)' : 'Not triggered',
    pass: null,
    source: 'ONEP notification (thresholds to confirm)',
  })
  return checks
}

export function validatePlot(plot: Ring): string | null {
  if (plot.length < 3) return 'A plot needs at least 3 corners.'
  if (isSelfIntersecting(plot)) return 'The plot outline crosses itself. Move a corner so the edges do not cross.'
  const a = Math.abs(signedArea(plot))
  if (a < 100) return 'The plot is smaller than 100 m², too small to analyse.'
  if (a > 200000) return 'The plot is larger than 20 ha. Draw a single development plot.'
  return null
}

export interface Analysis {
  limits: Limits
  low: Envelope | null
  high: Envelope | null
  concepts: Concept[]
  error: string | null
}

export function analyse(inp: Inputs): Analysis {
  const err = validatePlot(inp.plot)
  const L = limits(inp)
  if (err || !L.plane) return { limits: L, low: null, high: null, concepts: [], error: err ?? L.useBlocked }
  const low = buildEnvelope(inp, 'low', L.plane)
  const high = buildEnvelope(inp, 'high', L.plane)
  const concepts = [lowRiseConcept(inp, L), towerConcept(inp, L)]
  return { limits: L, low, high, concepts, error: null }
}

export function fmt(n: number, d = 0): string {
  if (!isFinite(n)) return '–'
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

// re-export for tests
export { polyArea, intersection }
