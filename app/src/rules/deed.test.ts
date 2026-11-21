import { describe, expect, it } from 'vitest'
import { checkDeed, deedArea, EMPTY_DEED } from './deed'

describe('title deed check', () => {
  it('converts Thai units', () => {
    expect(deedArea({ ...EMPTY_DEED, rai: 1, ngan: 1, wah: 86.5 })).toBeCloseTo(2346, 6)
    expect(deedArea({ ...EMPTY_DEED, unit: 'sqm', sqm: 500, rai: 9 })).toBe(500)
  })
  it('flags a drawn plot bigger than the deed', () => {
    const c = checkDeed({ ...EMPTY_DEED, unit: 'sqm', sqm: 2000 }, 2346)!
    expect(c.level).toBe('over')
    expect(c.diffPct).toBeCloseTo(17.3, 1)
  })
  it('accepts small differences and reports smaller plots', () => {
    expect(checkDeed({ ...EMPTY_DEED, unit: 'sqm', sqm: 2340 }, 2346)!.level).toBe('match')
    expect(checkDeed({ ...EMPTY_DEED, unit: 'sqm', sqm: 2600 }, 2346)!.level).toBe('under')
    expect(checkDeed(EMPTY_DEED, 2346)).toBeNull()
  })
})
