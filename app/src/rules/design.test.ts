import { describe, it, expect } from 'vitest'
import { analyse, DEFAULT_DESIGN, type Design } from './engine'

const plot = [[0, 0], [62, 0], [62, 50], [30, 50]] as [number, number][]
const run = (d: Partial<Design>) =>
  analyse({ plot, roads: [null, null, null, { width: 25 }], zone: 'ย.8', type: 'condo', nearStation: true, bonusPct: 0, design: { ...DEFAULT_DESIGN, ...d } }).concepts[2]
const fails = (c: ReturnType<typeof run>) => c.checks.filter((k) => k.pass === false).map((k) => k.id)

describe('your design', () => {
  it('a modest round tower passes', () => {
    const c = run({})
    expect(c.id).toBe('design')
    expect(fails(c)).toEqual([])
    // a 26 m circle floor is about pi * 13^2
    const top = c.blocks[0].floors[c.blocks[0].floors.length - 1]
    expect(top.area).toBeCloseTo(Math.PI * 13 * 13, -1)
  })
  it('an oversized design fails the right rules', () => {
    const c = run({ shape: 'rect', width: 60, depth: 45, towerFloors: 30 })
    expect(fails(c)).toEqual(expect.arrayContaining(['far', 'setbacks', 'height-plane']))
  })
  it('trimming to the envelope clears setback and height failures', () => {
    const c = run({ shape: 'rect', width: 60, depth: 45, towerFloors: 30, trim: true })
    expect(fails(c)).not.toContain('setbacks')
    expect(fails(c)).not.toContain('height-plane')
  })
  it('taper and twist shrink and turn the top floor', () => {
    const c = run({ shape: 'rect', width: 30, depth: 20, taper: 40, twist: 90, podiumFloors: 0 })
    const fl = c.blocks[0].floors
    expect(fl[fl.length - 1].area / fl[0].area).toBeCloseTo(0.36, 1)
  })
})
