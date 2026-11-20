import { describe, it, expect } from 'vitest'
import { analyse } from './engine'
import { presetsFor, clampCustom } from './systems'
import type { Ring } from '../geo/geom'

const plot: Ring = [[0, 0], [62, 0], [62, 50], [30, 50]]
const roads = [null, null, null, { width: 25 }]
const run = (system?: ReturnType<typeof presetsFor>[number]) =>
  analyse({ plot, roads, zone: 'ย.8', type: 'condo', nearStation: true, bonusPct: 0, system })

describe('structural systems', () => {
  it('precast tower plate is a whole number of 7.2 m bays and passes', () => {
    const pre = presetsFor('condo').find((s) => s.id === 'precast')!
    const a = run(pre)
    const tower = a.concepts.find((c) => c.id === 'tower')!
    expect(tower.checks.filter((k) => k.pass === false)).toEqual([])
    const top = tower.blocks.flatMap((b) => b.floors).filter((f) => f.use === 'residential')[0]
    // longest side of the first tower plate
    const r = top.plate[0][0]
    const sides = r.map((p, i) => Math.hypot(r[(i + 1) % r.length][0] - p[0], r[(i + 1) % r.length][1] - p[1]))
    const len = Math.max(...sides)
    expect(Math.abs(len / 7.2 - Math.round(len / 7.2))).toBeLessThan(1e-3)
  })
  it('lower storeys fit more floors under 23 m', () => {
    const rc = run()
    const pre = run(presetsFor('condo').find((s) => s.id === 'precast'))
    expect(pre.concepts[0].floors).toBeGreaterThanOrEqual(rc.concepts[0].floors)
  })
  it('big custom units switch condo parking to one per unit', () => {
    const big = clampCustom({ ...presetsFor('condo')[0], id: 'c1', name: 'Big units', use: 'condo', unitArea: 120 })
    const a = run(big)
    const t = a.concepts[1]
    expect(t.parkingRequired).toBeGreaterThanOrEqual(t.units)
  })
  it('clamps silly custom values', () => {
    const c = clampCustom({ ...presetsFor('condo')[0], id: 'x', name: 'x', use: 'condo', typH: 0.5, grid: 1, efficiency: 2 })
    expect(c.typH).toBe(2.6)
    expect(c.grid).toBe(0)
    expect(c.efficiency).toBe(0.92)
  })
})
