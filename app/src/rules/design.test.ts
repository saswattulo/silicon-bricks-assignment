import { describe, it, expect } from 'vitest'
import { analyse, DEFAULT_DESIGN, DEFAULT_FACADE, type Design } from './engine'

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

describe('stepped roof', () => {
  it('steps the top floors back and keeps the rest', () => {
    const base = { shape: 'rect' as const, width: 24, depth: 18 }
    const flat = run(base).blocks[0].floors
    const stepped = run({ ...base, facade: { ...DEFAULT_FACADE, roofSteps: 2, roofStepM: 2 } }).blocks[0].floors
    expect(stepped.length).toBe(flat.length)
    expect(stepped.at(-1)!.area).toBeLessThan(stepped.at(-2)!.area)
    expect(stepped.at(-2)!.area).toBeLessThan(stepped.at(-3)!.area)
    expect(stepped.at(-3)!.area).toBeCloseTo(flat.at(-3)!.area, 3)
  })
})

describe('tiers', () => {
  it('stacks tiers of different sizes and counts their floors', () => {
    const c = run({ podiumFloors: 2, tiers: [
      { floors: 6, shape: 'rect', width: 30, depth: 20, dx: 0, dy: 0 },
      { floors: 4, shape: 'rect', width: 20, depth: 14, dx: 3, dy: 2 },
    ] })
    const fl = c.blocks[0].floors
    expect(fl.length).toBe(12)
    expect(fl[2].area).toBeCloseTo(600, 0)
    expect(fl[11].area).toBeCloseTo(280, 0)
    expect(c.name).toContain('stepped')
  })
})
