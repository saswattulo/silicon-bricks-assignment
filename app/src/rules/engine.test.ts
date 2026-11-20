import { describe, it, expect } from 'vitest'
import { analyse, roadSetback, type Inputs } from './engine'
import type { Ring } from '../geo/geom'

const rect = (w: number, h: number): Ring => [[0, 0], [w, 0], [w, h], [0, h]]

function run(plot: Ring, roadEdge: number, width: number, type: Inputs['type'] = 'condo') {
  const roads = plot.map((_, i) => (i === roadEdge ? { width } : null))
  return analyse({ plot, roads, zone: 'ย.8', type, nearStation: false, bonusPct: 0 })
}

describe('rules', () => {
  it('road setback bands', () => {
    expect(roadSetback(8)).toBe(2)
    expect(roadSetback(12)).toBeCloseTo(1.2)
    expect(roadSetback(30)).toBe(2)
  })
  for (const [name, plot] of [
    ['rect 50x70', rect(50, 70)],
    ['L-shape', [[0,0],[80,0],[80,30],[35,30],[35,70],[0,70]] as Ring],
    ['triangle', [[0,0],[90,0],[20,80]] as Ring],
    ['thin', rect(18, 90)],
  ] as [string, Ring][]) {
    it(`concepts pass on ${name}`, () => {
      const a = run(plot, 0, 12)
      expect(a.error).toBeNull()
      for (const c of a.concepts) {
        const fails = c.checks.filter((k) => k.pass === false)
        console.log(name, c.name, 'GFA', Math.round(c.gfa), 'H', c.height.toFixed(1), 'FAR', (c.gfa / a.limits.plotArea).toFixed(2), 'open', Math.round(c.openSpace), c.infeasible ?? '', fails.map((f) => `${f.id}: ${f.actual} vs ${f.required}`))
      }
    })
  }
  it('large plot on a 12 m road: both concepts pass (road band + 30,000 m² cap)', () => {
    const a = run(rect(150, 120), 0, 12)
    expect(a.limits.gfaCap).toBe(30000)
    for (const c of a.concepts) {
      const fails = c.checks.filter((k) => k.pass === false).map((f) => `${c.name} ${f.id}: ${f.actual}`)
      expect(fails).toEqual([])
      expect(c.gfa).toBeLessThanOrEqual(a.limits.gfaCap + 0.5)
    }
  })
})
