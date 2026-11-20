// Structural systems: how a building is built changes its storey heights, how deep and long a
// floor plate can be, the column/panel grid, and how much of each floor is sellable.
// Figures are typical Thai practice for pre-design, not engineering.
import { TYPES, type BuildingType, type SystemSpec } from './engine'

type Delta = Omit<SystemSpec, 'id' | 'name' | 'unitArea'> & { unitArea?: number }

const P: Record<BuildingType, Record<'rc' | 'precast' | 'pt' | 'steel', Delta>> = {
  condo: {
    rc: { groundH: 4.5, typH: 3.0, lowGroundH: 3.2, lowTypH: 2.8, efficiency: 0.72, towerDepth: 21, towerMaxLen: 60, grid: 0 },
    precast: { groundH: 4.2, typH: 2.9, lowGroundH: 3.0, lowTypH: 2.8, efficiency: 0.75, towerDepth: 17, towerMaxLen: 57.6, grid: 7.2 },
    pt: { groundH: 4.5, typH: 2.9, lowGroundH: 3.2, lowTypH: 2.75, efficiency: 0.73, towerDepth: 22, towerMaxLen: 58.8, grid: 8.4 },
    steel: { groundH: 4.5, typH: 3.2, lowGroundH: 3.4, lowTypH: 3.0, efficiency: 0.74, towerDepth: 21, towerMaxLen: 54, grid: 9 },
  },
  hotel: {
    rc: { groundH: 5.0, typH: 3.2, lowGroundH: 4.0, lowTypH: 3.0, efficiency: 0.62, towerDepth: 19, towerMaxLen: 60, grid: 0 },
    precast: { groundH: 4.8, typH: 3.0, lowGroundH: 3.6, lowTypH: 2.9, efficiency: 0.64, towerDepth: 17, towerMaxLen: 57.6, grid: 7.2 },
    pt: { groundH: 5.0, typH: 3.1, lowGroundH: 4.0, lowTypH: 2.95, efficiency: 0.63, towerDepth: 19, towerMaxLen: 58.8, grid: 8.4 },
    steel: { groundH: 5.0, typH: 3.4, lowGroundH: 4.0, lowTypH: 3.2, efficiency: 0.64, towerDepth: 19, towerMaxLen: 54, grid: 9 },
  },
  office: {
    rc: { groundH: 5.0, typH: 3.8, lowGroundH: 4.5, lowTypH: 3.6, efficiency: 0.75, towerDepth: 26, towerMaxLen: 50, grid: 0 },
    precast: { groundH: 5.0, typH: 3.9, lowGroundH: 4.5, lowTypH: 3.7, efficiency: 0.76, towerDepth: 24, towerMaxLen: 48, grid: 9.6 },
    pt: { groundH: 5.0, typH: 3.6, lowGroundH: 4.5, lowTypH: 3.5, efficiency: 0.76, towerDepth: 26, towerMaxLen: 50.4, grid: 8.4 },
    steel: { groundH: 5.0, typH: 4.0, lowGroundH: 4.5, lowTypH: 3.8, efficiency: 0.8, towerDepth: 30, towerMaxLen: 54, grid: 9 },
  },
}

const NAMES = {
  rc: 'Cast-in-place concrete',
  precast: 'Precast concrete',
  pt: 'Post-tensioned flat slab',
  steel: 'Steel frame',
} as const

export const SYSTEM_NOTES: Record<string, string> = {
  rc: 'Conventional beam-and-slab frame. Free plate shape.',
  precast: 'Factory wall panels and hollow-core slabs on a 7.2 m bay (9.6 m double-tees for offices). Lower storeys, narrower plates, fast to build.',
  pt: 'Thin post-tensioned slabs: lower floor-to-floor and long spans on an 8.4 m grid.',
  steel: 'Steel frame with composite deck on a 9 m grid. Deeper plates, taller storeys.',
}

export function presetsFor(type: BuildingType): SystemSpec[] {
  return (Object.keys(P[type]) as (keyof typeof NAMES)[]).map((id) => ({
    id,
    name: NAMES[id],
    unitArea: TYPES[type].unitArea,
    ...P[type][id],
  }))
}

/** A user-made building: its own use and structure, kept in this browser. */
export interface CustomBuilding extends SystemSpec {
  use: BuildingType
}

export const CUSTOM_LIMITS: Record<keyof Omit<SystemSpec, 'id' | 'name'>, [number, number, string]> = {
  groundH: [3, 8, 'Ground floor height (m)'],
  typH: [2.6, 6, 'Typical floor-to-floor (m)'],
  lowGroundH: [2.8, 6, 'Low-rise ground floor (m)'],
  lowTypH: [2.6, 5, 'Low-rise floor-to-floor (m)'],
  towerDepth: [10, 40, 'Tower plate depth (m)'],
  towerMaxLen: [15, 100, 'Max tower length (m)'],
  grid: [0, 12, 'Structural bay (m, 0 = free)'],
  efficiency: [0.5, 0.92, 'Sellable / gross'],
  unitArea: [20, 300, 'Average unit or room (m²)'],
}

export function clampCustom(c: CustomBuilding): CustomBuilding {
  const out = { ...c }
  for (const k of Object.keys(CUSTOM_LIMITS) as (keyof typeof CUSTOM_LIMITS)[]) {
    const [lo, hi] = CUSTOM_LIMITS[k]
    const v = Number(out[k])
    if (!Number.isFinite(v)) out[k] = lo
    else if (k === 'grid' && v < 3) out[k] = 0 // no grid
    else out[k] = Math.min(hi, Math.max(k === 'grid' ? 3 : lo, v))
  }
  return out
}
