import { describe, it, expect } from 'vitest'
import { bangkokDate, prismShadow, shadowVector, sunPosition } from './sun'
import { mpArea } from './geom'

const BKK: [number, number] = [13.7266, 100.5806]
const deg = (r: number) => (r * 180) / Math.PI

describe('sun', () => {
  it('December solar noon in Bangkok is low in the south', () => {
    // solar noon in Bangkok (100.58°E, UTC+7) is about 12:16 local in late December
    const s = sunPosition(bangkokDate(2026, 11, 21, 12.27), ...BKK)
    expect(deg(s.altitude)).toBeCloseTo(90 - 13.73 - 23.44, 0)
    expect(Math.abs(deg(s.azimuth) - 180)).toBeLessThan(3)
  })
  it('equinox morning sun is in the east', () => {
    const s = sunPosition(bangkokDate(2026, 2, 21, 9), ...BKK)
    expect(deg(s.azimuth)).toBeGreaterThan(80)
    expect(deg(s.azimuth)).toBeLessThan(110)
  })
  it('night has no shadow', () => {
    expect(shadowVector(sunPosition(bangkokDate(2026, 2, 21, 23), ...BKK))).toBeNull()
  })
  it('box shadow area matches the swept prism', () => {
    const sq = [[[[0, 0], [10, 0], [10, 10], [0, 10]]]] as never
    // sun due south at 45°: shadow 20 m long to the north, plus the 10x10 base
    const sh = prismShadow(sq, 0, 20, [0, 1])
    expect(mpArea(sh)).toBeCloseTo(10 * 30, 3)
    // an elevated slab only: the base is not shaded
    const up = prismShadow(sq, 10, 20, [0, 1])
    expect(mpArea(up)).toBeCloseTo(10 * 20, 3)
  })
})
